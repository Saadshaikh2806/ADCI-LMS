import{n as e,r as t}from"./rolldown-runtime-QTnfLwEv.js";import{t as n}from"./framework~index~layout~page~app-page-cache-render~app-page-cache~seed-cache~app-route-handl~beoizrd4-D2DrRkkV.js";import{t as r}from"./framework~index~layout~app-page-cache-render~app-page-cache~seed-cache~app-route-handler-dispatch-BXTHPf7x.js";import i from"../../__vite_rsc_assets_manifest.js";var a=t(n());function o(e){return e.replace(/\\/g,`\\\\`).replace(/'/g,`\\'`).replace(/\n/g,`\\a `).replace(/\r/g,`\\d `)}function s(e){if(/^--[a-zA-Z0-9_-]+$/.test(e))return e}function ee(e){let t=new Set([`serif`,`sans-serif`,`monospace`,`cursive`,`fantasy`,`system-ui`,`ui-serif`,`ui-sans-serif`,`ui-monospace`,`ui-rounded`,`emoji`,`math`,`fangsong`]),n=e.trim();return t.has(n)?n:`'${o(n)}'`}function c(e){return Array.isArray(e)?new Set(e).size===1?e[0]:void 0:e}function l(e){if(!/[{};]|\/\*|\*\/|<\//i.test(e))return e}function u(e){let t=c(e);if(!t||t.includes(` `))return;let n=Number(t);return Number.isFinite(n)?n:void 0}function d(e){let t=c(e);if(!(!t||t.includes(` `)))return l(t)}function f(e){if(e===void 0)return`normal`;let t=c(e);if(t&&(t===`normal`||t===`italic`))return t}function te(e){let t=e.internalWeight??u(e.weight),n=(e.internalStyle?l(e.internalStyle):void 0)??(e.google?f(e.style):d(e.style));return{fontFamily:e.fontFamily,...t===void 0?{}:{fontWeight:t},...n?{fontStyle:n}:{}}}function p(e,t){let n=t.fontStyle?l(t.fontStyle):void 0;return`.${e} { ${[`font-family: ${t.fontFamily}`,...t.fontWeight===void 0?[]:[`font-weight: ${t.fontWeight}`],...n?[`font-style: ${n}`]:[]].join(`; `)}; }\n`}function m(e){return e.endsWith(`.woff2`)?`font/woff2`:e.endsWith(`.woff`)?`font/woff`:e.endsWith(`.ttf`)?`font/ttf`:e.endsWith(`.otf`)?`font/opentype`:`font/woff2`}function h(e,t){if(e.includes(`,`)&&t.includes(`,`)){let[n,r]=e.split(`,`,2),[i,a]=t.split(`,`,2);return n===i?parseInt(r)-parseInt(a):parseInt(n)-parseInt(i)}return parseInt(e)-parseInt(t)}function g(e,t,n){let r=[];if(t.wght)for(let e of t.wght)if(!t.ital)r.push([[`wght`,e],...t.variableAxes??[]]);else for(let n of t.ital)r.push([[`ital`,n],[`wght`,e],...t.variableAxes??[]]);else t.variableAxes&&r.push([...t.variableAxes]);if(t.variableAxes)for(let e of r)e.sort(([e],[t])=>{let n=e.charCodeAt(0)>96,r=t.charCodeAt(0)>96;return n&&!r?-1:r&&!n||e>t?1:-1});let i=`https://fonts.googleapis.com/css2?family=${e.replace(/ /g,`+`)}`;if(r.length>0){let e=r[0].map(([e])=>e).join(`,`),t=r.map(e=>e.map(([,e])=>e).join(`,`)).sort(h).join(`;`);i=`${i}:${e}@${t}`}return`${i}&display=${n}`}var _=Symbol.for(`vinext.font.injectedFonts`),v=Symbol.for(`vinext.font.injectedClassRules`),y=Symbol.for(`vinext.font.injectedVariableRules`),b=Symbol.for(`vinext.font.injectedSelfHosted`),x=Symbol.for(`vinext.font.ssrFontStyles`),S=Symbol.for(`vinext.font.ssrFontUrls`),C=Symbol.for(`vinext.font.ssrFontPreloads`),w=Symbol.for(`vinext.font.ssrFontPreloadHrefs`),T=globalThis,E=T[_]??=new Set;function ne(e){return`--font-`+e.toLowerCase().replace(/\s+/g,`-`)}function D(e){return e.toLowerCase().replace(/[^a-z0-9_-]+/g,`_`).replace(/^_+|_+$/g,``)||`font`}function O(e){return e?[...new Set((Array.isArray(e)?e:[e]).map(e=>e.trim()).filter(Boolean))].sort().join(`,`):``}function k(e){let t=O(e);return t===`variable`?``:t}function A(e){let t=new Set((Array.isArray(e)?e:e?[e]:[]).map(e=>e.trim()).filter(Boolean)),n=t.has(`italic`),r=t.has(`normal`);return n?r?`italic,normal`:`italic`:``}function j(e){return e?e.map(e=>e.trim()).join(`,`):``}function M(e){return e===void 0?``:e?`1`:`0`}function N(e){return e===void 0?``:typeof e==`boolean`?M(e):e}function P(e){let t=2166136261;for(let n=0;n<e.length;n++)t^=e.charCodeAt(n),t=Math.imul(t,16777619)>>>0;return t.toString(36).padStart(7,`0`)}function F(e,t,n,r){return P([e,n,k(t.weight),A(t.style),O(t.subsets),t.display??`swap`,M(t.preload),j(r),N(t.adjustFontFallback),O(t.axes),t._vinext?.font?.selfHostedCSS??``,t._vinext?.font?.fontWeight?.toString()??``,t._vinext?.font?.fontStyle??``].join(`\0`))}function I(e,t){let n=t.weight?Array.isArray(t.weight)?t.weight:[t.weight]:[],r=t.style?Array.isArray(t.style)?t.style:[t.style]:[],i=r.includes(`italic`),a=r.includes(`normal`),o=i?[...a?[`0`]:[],`1`]:void 0,s=n.length===1&&n[0]===`variable`?[]:n;return g(e,{wght:s.length>0?s:o?[`400`]:void 0,ital:o},t.display??`swap`)}function L(e){if(!E.has(e)&&(E.add(e),typeof document<`u`)){let t=document.createElement(`link`);t.rel=`stylesheet`,t.href=e,document.head.appendChild(t)}}var R=T[v]??=new Set;function z(e,t){if(R.has(e))return;R.add(e);let n=p(e,t);if(typeof document>`u`){H.push(n);return}let r=document.createElement(`style`);r.textContent=n,r.setAttribute(`data-vinext-font-class`,e),document.head.appendChild(r)}var B=T[y]??=new Set;function V(e,t,n){if(B.has(e))return;B.add(e);let r=`.${e} { ${t}: ${n}; }\n`;if(typeof document>`u`){H.push(r);return}let i=document.createElement(`style`);i.textContent=r,i.setAttribute(`data-vinext-font-variable`,e),document.head.appendChild(i)}var H=T[x]??=[];function re(){return[...H]}var U=T[S]??=[];function W(){return[...U]}var G=T[C]??=[],K=T[w]??=new Set;function q(){return[...G]}function J(e){if(!(typeof document<`u`))for(let t of e)t.startsWith(`/`)&&!K.has(t)&&(K.add(t),G.push({href:t,type:m(t)}))}var Y=T[b]??=new Set;function X(e,t=[]){if(J(t),Y.has(e))return;if(Y.add(e),typeof document>`u`){H.push(e);return}let n=document.createElement(`style`);n.textContent=e,n.setAttribute(`data-vinext-font-selfhosted`,`true`),document.head.appendChild(n)}function Z(e){return function(t={}){let n=t._vinext?.font,r=t.fallback??[],i=t.adjustFontFallback===!1||!n?.adjustedFallbackCSS?[]:[`'${o(e)} Fallback'`],a=[`'${o(e)}'`,...i,...r.map(ee)].join(`, `),c=ne(e),l=t.variable?s(t.variable)??c:c,u=F(e,t,l,r),d=D(e),f=`__font_${d}_${u}`,p=`__variable_${d}_${u}`,m=te({fontFamily:a,weight:t.weight,style:t.style,internalWeight:n?.fontWeight,internalStyle:n?.fontStyle,google:!0});if(n?.selfHostedCSS)X(n.selfHostedCSS,n.preloadUrls);else{let n=I(e,t);L(n),typeof document>`u`&&(U.includes(n)||U.push(n))}return t.adjustFontFallback!==!1&&n?.adjustedFallbackCSS&&X(n.adjustedFallbackCSS),z(f,m),t.variable&&V(p,l,a),{className:f,style:m,...t.variable?{variable:p}:{}}}}var ie=new Proxy({},{get(e,t){if(typeof t==`string`)return t==="__esModule"?!0:t==="default"?ie:Z(t.replace(/_/g,` `).replace(/([a-z])([A-Z])/g,`$1 $2`))}}),ae=((e,t,n,r)=>function(){return e.createElement(e.Fragment,null,[...t.css.map(t=>e.createElement(`link`,{key:`css:`+t,rel:`stylesheet`,...r?{precedence:r}:{},href:t,"data-rsc-css-href":t})),n&&e.createElement(n,{key:`remove-duplicate-css`})])})(a.default,i.serverResources[`app/layout.tsx`],void 0,`vite-rsc/importer-resources`),oe=Z(`DM Sans`),se=Z(`Manrope`),Q=e({default:()=>fe,metadata:()=>ue}),$=r(),ce=oe({subsets:[`latin`],variable:`--font-body`,_vinext:{font:{selfHostedCSS:`/* latin-ext */
@font-face {
  font-family: 'DM Sans';
  font-style: normal;
  font-weight: 100 1000;
  font-display: swap;
  src: url(/_next/static/_vinext_fonts/dm-sans-90624ee039aa/dm-sans-f6298972.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
/* latin */
@font-face {
  font-family: 'DM Sans';
  font-style: normal;
  font-weight: 100 1000;
  font-display: swap;
  src: url(/_next/static/_vinext_fonts/dm-sans-90624ee039aa/dm-sans-151a53ae.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
`,preloadUrls:[`/_next/static/_vinext_fonts/dm-sans-90624ee039aa/dm-sans-151a53ae.woff2`],adjustedFallbackCSS:`@font-face {
  font-family: 'DM Sans Fallback';
  src: local("Arial");
  ascent-override: 94.90%;
  descent-override: 29.66%;
  line-gap-override: 0.00%;
  size-adjust: 104.53%;
}
`,fontStyle:`normal`}}}),le=se({subsets:[`latin`],variable:`--font-display`,_vinext:{font:{selfHostedCSS:`/* cyrillic-ext */
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
  src: url(/_next/static/_vinext_fonts/manrope-76eca2803f7f/manrope-37facb2a.woff2) format('woff2');
  unicode-range: U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F;
}
/* cyrillic */
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
  src: url(/_next/static/_vinext_fonts/manrope-76eca2803f7f/manrope-c9a5f13c.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
/* greek */
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
  src: url(/_next/static/_vinext_fonts/manrope-76eca2803f7f/manrope-f00fa027.woff2) format('woff2');
  unicode-range: U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF;
}
/* vietnamese */
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
  src: url(/_next/static/_vinext_fonts/manrope-76eca2803f7f/manrope-bd6e7fdc.woff2) format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
}
/* latin-ext */
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
  src: url(/_next/static/_vinext_fonts/manrope-76eca2803f7f/manrope-76dcfc73.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
/* latin */
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
  src: url(/_next/static/_vinext_fonts/manrope-76eca2803f7f/manrope-81401990.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
`,preloadUrls:[`/_next/static/_vinext_fonts/manrope-76eca2803f7f/manrope-81401990.woff2`],adjustedFallbackCSS:`@font-face {
  font-family: 'Manrope Fallback';
  src: local("Arial");
  ascent-override: 103.31%;
  descent-override: 29.07%;
  line-gap-override: 0.00%;
  size-adjust: 103.19%;
}
`,fontStyle:`normal`}}}),ue={title:`ADCI Learning Hub`,description:`Your learning, classes, assessments and progress in one place.`};function de({children:e}){return(0,$.jsx)(`html`,{lang:`en`,children:(0,$.jsx)(`body`,{className:`${ce.variable} ${le.variable}`,children:e})})}var fe=pe(de,`default`);function pe(e,t){if(typeof e!=`function`)return e;function n(t){return a.createElement(a.Fragment,null,a.createElement(ae),a.createElement(e,t))}return Object.defineProperty(n,"name",{value:t}),n}export{re as i,W as n,q as r,Q as t};