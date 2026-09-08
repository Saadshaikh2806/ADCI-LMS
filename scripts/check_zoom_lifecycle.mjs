import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compile = path => ts.transpileModule(readFileSync(path, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function zoomModule(fetchImpl) {
  const exports = {};
  runInNewContext(compile("lib/zoom/server.ts"), {
    exports, AbortSignal, Buffer, URL, URLSearchParams,
    require: name => name === "server-only" ? {} : name === "../supabase/server"
      ? { requireServerEnvironment: () => "test-only" } : require(name),
    fetch: async (url, init) => url === "https://zoom.us/oauth/token"
      ? Response.json({ access_token: "test-only" }) : fetchImpl(url, init)
  });
  return exports;
}
for (const status of [401,403,429,500]) {
  const zoom = zoomModule(async () => Response.json({message:"Provider rejected request"}, {status}));
  await assert.rejects(() => zoom.endZoomMeeting("123"), /Provider rejected/);
  await assert.rejects(() => zoom.deleteZoomMeeting("123"), /Provider rejected/);
}
{
  const zoom = zoomModule(async () => { throw new Error("Network unavailable"); });
  await assert.rejects(() => zoom.endZoomMeeting("123"), /Network unavailable/);
  await assert.rejects(() => zoom.deleteZoomMeeting("123"), /Network unavailable/);
}
for (const code of [1001,3001]) {
  const zoom = zoomModule(async () => Response.json({code,message:"Not found"}, {status:404}));
  if (code === 3001) {
    await zoom.endZoomMeeting("123"); await zoom.deleteZoomMeeting("123");
  } else {
    await assert.rejects(() => zoom.endZoomMeeting("123"), /Not found/);
    await assert.rejects(() => zoom.deleteZoomMeeting("123"), /Not found/);
  }
}
for (const status of ["waiting","started"]) {
  const calls=[];
  const zoom=zoomModule(async (url,init)=>{
    calls.push(init.method || "GET");
    return init.method ? new Response(null,{status:204}) : Response.json({status});
  });
  await zoom.endZoomMeeting("123"); await zoom.deleteZoomMeeting("123");
  assert.deepEqual(calls,status==="waiting"?["GET","DELETE"]:["GET","PUT","DELETE"]);
}

async function routeScenario(options = {}) {
  const calls=[];
  const job={meeting_number:"123",organization_id:"org"};
  const exports={};
  const service={
    rpc:async()=>({data:job}),
    from:()=>({
      operation:"read",
      select(){return this;},eq(){return this;},
      maybeSingle:async()=>({data:options.pending?job:null}),
      delete(){this.operation="queue-delete";return this;},
      update(){this.operation="queue-error";return this;},
      then(resolve,reject){
        calls.push(this.operation);
        return Promise.resolve({error:null}).then(resolve,reject);
      }
    })
  };
  runInNewContext(compile("app/api/live-sessions/zoom/end/route.ts"), {
    exports,Response,console,
    require:name=>name.endsWith("supabase/server") ? {
      requireServerUser:async()=>{
        if(options.sessionError) throw new Error("Session no longer active");
        return {user:{id:"staff"},service,userClient:{rpc:async(name,args)=>{
          if(name==="adci_current_user_has_role") {
            calls.push("permission");
            const role=options.role || "super_admin";
            return {data:args.allowed_roles.includes(role)};
          }
          calls.push("database-delete");
          return {error:options.stale?{message:"Purchases changed"}:null};
        }}};
      }
    } : name.endsWith("zoom/server") ? {
      ZoomApiError:Error,
      endZoomMeeting:async()=>{calls.push("zoom-end");if(options.providerError)throw new Error("Zoom unavailable");},
      deleteZoomMeeting:async()=>{calls.push("zoom-delete");if(options.deleteError)throw new Error("Zoom delete rejected");}
    } : {
      enforceApiRateLimit:async()=>{},apiErrorHeaders:()=>({}),apiErrorStatus:(_,fallback)=>fallback
    }
  });
  const response=await exports.POST(new Request("https://example.test/api/live-sessions/zoom/end",{
    method:"POST",body:JSON.stringify({
      lessonId:"00000000-0000-0000-0000-000000000001",
      alsoDelete:options.endOnly?false:true,
      ...(!options.noCount && {purchasedLearners:2})
    })
  }));
  return {status:response.status,body:await response.json(),calls};
}
for (const options of [{role:"instructor"},{role:"student"},{role:"support"},{stale:true},{noCount:true},{sessionError:true}]) {
  const result=await routeScenario(options);
  assert.ok(result.status>=400);
  assert.ok(!result.calls.some(call=>call.startsWith("zoom-")), "unauthorized/stale/unconfirmed request must not touch Zoom");
}
{
  const result=await routeScenario();
  assert.equal(result.body.zoomRemoved,true);
  assert.deepEqual(result.calls,["permission","database-delete","zoom-end","zoom-delete","queue-delete"]);
}
for (const options of [{providerError:true},{deleteError:true}]) {
  const result=await routeScenario(options);
  assert.equal(result.status,200,"LMS deletion committed");
  assert.equal(result.body.zoomRemoved,false,"provider failure is explicitly reported");
  assert.ok(result.body.warning);
  assert.ok(result.calls.includes("queue-error"));
  assert.ok(!result.calls.includes("queue-delete"),"failed cleanup remains retryable");
}
{
  const result=await routeScenario({pending:true,noCount:true});
  assert.equal(result.body.zoomRemoved,true);
  assert.ok(!result.calls.includes("database-delete"),"retry uses retained ownership without deleting again");
}
{
  const result=await routeScenario({role:"instructor",endOnly:true});
  assert.equal(result.status,200,"instructor may end, but cannot delete");
}
{
  const result=await routeScenario({endOnly:true,providerError:true});
  assert.ok(result.status>=400,"end failure must never look successful");
}
console.log("Zoom lifecycle checks passed: provider errors, missing meetings, waiting/live state, permissions, session denial, stale purchases, ordered deletion and retry.");

// Execute the actual maintenance script against a paginated, isolated provider.
// No untracked host meetings are ever requested or eligible for deletion.
for (const apply of [false, true]) {
  const pending = Array.from({length:201}, (_,i)=>({lesson_id:String(i),meeting_number:String(1000+i),title:"Class "+i}));
  const providerDeletes=[];
  const queueDeletes=[];
  const offsets=[];
  const processMock={argv:apply?["node","cleanup","--apply"]:["node","cleanup"],env:{
    NEXT_PUBLIC_SUPABASE_URL:"https://database.example",SUPABASE_SERVICE_ROLE_KEY:"test-only",
    ZOOM_API_CLIENT_ID:"test",ZOOM_API_CLIENT_SECRET:"test",ZOOM_ACCOUNT_ID:"test"
  },exitCode:0};
  const source=readFileSync("scripts/cleanup_orphan_zoom_meetings.mjs","utf8")
    .replace('import { readFileSync } from "node:fs";', 'const readFileSync = () => { throw new Error("No env file in test"); };')
    .replaceAll("import.meta.url",'"file:///test/scripts/cleanup.mjs"');
  await runInNewContext("(async()=>{"+source+"})()", {
    URL,URLSearchParams,Buffer,AbortSignal,process:processMock,console:{log(){},error(){}},
    fetch:async (url,init={})=>{
      if(url.startsWith("https://database.example/")) {
        const parsed=new URL(url);
        assert.equal(parsed.pathname,"/rest/v1/adci_zoom_cleanup");
        if(init.method==="DELETE") {
          queueDeletes.push(parsed.searchParams.get("lesson_id").slice(3));
          return new Response(null,{status:204});
        }
        const offset=Number(parsed.searchParams.get("offset"));offsets.push(offset);
        return Response.json(pending.slice(offset,offset+200));
      }
      if(url==="https://zoom.us/oauth/token") return Response.json({access_token:"test-only"});
      const match=url.match(/^https:\/\/api.zoom.us\/v2\/meetings\/(\d+)$/);
      assert.ok(match,"cleanup must not enumerate arbitrary host meetings");
      if(init.method==="DELETE") {
        providerDeletes.push(match[1]);
        return match[1]==="1000" ? Response.json({message:"Permission denied"},{status:403}) : new Response(null,{status:204});
      }
      return Response.json({status:"waiting"});
    }
  });
  assert.deepEqual(offsets,[0,200],"fetches beyond one page before deleting");
  assert.equal(providerDeletes.length,apply?201:0);
  assert.equal(queueDeletes.length,apply?200:0);
  assert.ok(!queueDeletes.includes("0"),"failed removal remains queued");
  assert.equal(processMock.exitCode,apply?1:0);
}
console.log("Cleanup script checks passed: approved ownership only, pagination, dry run, retained failures and nonzero failure exit.");
