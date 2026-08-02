#!/usr/bin/env python3
"""Bulk-convert lecture videos to web-optimized H.264/AAC MP4 files.

The script preserves the input folder structure, never overwrites source files,
uses a temporary output during encoding, and skips completed outputs by default.
FFmpeg and FFprobe must be installed separately and available on PATH.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


VIDEO_EXTENSIONS = {
    ".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".mts", ".m2ts",
    ".wmv", ".flv", ".mpeg", ".mpg", ".3gp",
}


@dataclass(frozen=True)
class Profile:
    width: int
    height: int
    crf: int
    max_rate: str
    buffer_size: str
    audio_rate: str


PROFILES = {
    "720p": Profile(1280, 720, 23, "2500k", "5000k", "96k"),
    "1080p": Profile(1920, 1080, 22, "3500k", "7000k", "128k"),
}


@dataclass(frozen=True)
class MediaInfo:
    duration: float
    width: int
    height: int
    fps: float


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert a folder of lecture videos to web-optimized MP4 files.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("input", type=Path, help="Folder containing source videos")
    parser.add_argument("output", type=Path, help="Separate folder for optimized videos")
    parser.add_argument(
        "--profile", choices=sorted(PROFILES), default="720p",
        help="720p for smallest files; 1080p for slides with small text",
    )
    parser.add_argument(
        "--preset",
        choices=("veryfast", "faster", "fast", "medium", "slow", "slower"),
        default="medium",
        help="Slower presets compress better but take longer",
    )
    parser.add_argument("--crf", type=int, help="Override quality value (lower is higher quality)")
    parser.add_argument("--overwrite", action="store_true", help="Replace existing optimized outputs")
    parser.add_argument("--dry-run", action="store_true", help="Show planned conversions without encoding")
    parser.add_argument("--ffmpeg", help="Path to ffmpeg.exe if it is not on PATH")
    parser.add_argument("--ffprobe", help="Path to ffprobe.exe if it is not on PATH")
    return parser.parse_args()


def resolve_program(explicit_path: str | None, name: str) -> str:
    candidate = explicit_path or shutil.which(name)
    if not candidate:
        raise RuntimeError(
            f"{name} was not found. Install FFmpeg and reopen the terminal, "
            f"or provide --{name} with the full executable path."
        )
    resolved = Path(candidate).expanduser()
    if explicit_path and not resolved.is_file():
        raise RuntimeError(f"{name} does not exist at: {resolved}")
    return str(resolved if explicit_path else candidate)


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def discover_videos(input_root: Path, output_root: Path) -> list[Path]:
    videos: list[Path] = []
    output_inside_input = is_relative_to(output_root, input_root)
    for path in input_root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        resolved = path.resolve()
        if output_inside_input and is_relative_to(resolved, output_root):
            continue
        videos.append(resolved)
    return sorted(videos, key=lambda item: str(item).lower())


def parse_fraction(value: str | None) -> float:
    if not value or value in {"0/0", "N/A"}:
        return 0.0
    numerator, separator, denominator = value.partition("/")
    try:
        return float(numerator) / float(denominator) if separator and float(denominator) else float(value)
    except (TypeError, ValueError, ZeroDivisionError):
        return 0.0


def probe_media(ffprobe: str, source: Path) -> MediaInfo:
    command = [
        ffprobe,
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,avg_frame_rate:format=duration",
        "-of", "json",
        str(source),
    ]
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "FFprobe could not read this video")
    payload = json.loads(result.stdout)
    streams = payload.get("streams") or []
    if not streams:
        raise RuntimeError("No video stream was found")
    stream = streams[0]
    return MediaInfo(
        duration=max(0.0, float((payload.get("format") or {}).get("duration") or 0)),
        width=int(stream.get("width") or 0),
        height=int(stream.get("height") or 0),
        fps=parse_fraction(stream.get("avg_frame_rate")),
    )


def output_for(source: Path, input_root: Path, output_root: Path) -> Path:
    return (output_root / source.relative_to(input_root)).with_suffix(".mp4")


def find_output_collisions(sources: Iterable[Path], input_root: Path, output_root: Path) -> list[Path]:
    seen: dict[Path, Path] = {}
    collisions: list[Path] = []
    for source in sources:
        destination = output_for(source, input_root, output_root)
        if destination in seen:
            collisions.extend([seen[destination], source])
        else:
            seen[destination] = source
    return sorted(set(collisions), key=lambda item: str(item).lower())


def format_duration(seconds: float) -> str:
    seconds = max(0, int(seconds))
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def make_command(
    ffmpeg: str,
    source: Path,
    temporary_output: Path,
    profile: Profile,
    preset: str,
    crf: int,
    media: MediaInfo,
) -> list[str]:
    scale = (
        f"scale=w=min({profile.width}\\,iw):h=min({profile.height}\\,ih):"
        "force_original_aspect_ratio=decrease:force_divisible_by=2"
    )
    command = [
        ffmpeg,
        "-hide_banner", "-y",
        "-i", str(source),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", scale,
        "-c:v", "libx264",
        "-preset", preset,
        "-crf", str(crf),
        "-maxrate", profile.max_rate,
        "-bufsize", profile.buffer_size,
        "-profile:v", "high",
        "-level:v", "4.1",
        "-pix_fmt", "yuv420p",
    ]
    if media.fps > 30.01:
        command.extend(["-r", "30"])
    keyframe_interval = max(24, round(min(media.fps or 30, 30) * 2))
    command.extend([
        "-g", str(keyframe_interval),
        "-c:a", "aac",
        "-b:a", profile.audio_rate,
        "-ac", "2",
        "-movflags", "+faststart",
        "-map_metadata", "0",
        "-sn",
        "-max_muxing_queue_size", "4096",
        "-progress", "pipe:1",
        "-nostats",
        str(temporary_output),
    ])
    return command


def encode_video(command: list[str], duration: float, label: str) -> tuple[bool, str]:
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    recent_output: list[str] = []
    assert process.stdout is not None
    for raw_line in process.stdout:
        line = raw_line.strip()
        if line:
            recent_output.append(line)
            recent_output = recent_output[-25:]
        if line.startswith("out_time_ms=") and duration > 0:
            try:
                completed_seconds = int(line.split("=", 1)[1]) / 1_000_000
                percentage = min(100, max(0, round(completed_seconds / duration * 100)))
                print(f"\r    {label}: {percentage:3d}%", end="", flush=True)
            except ValueError:
                pass
    return_code = process.wait()
    if duration > 0:
        print("\r" + " " * (len(label) + 16) + "\r", end="")
    return return_code == 0, "\n".join(recent_output)


def main() -> int:
    arguments = parse_arguments()
    input_root = arguments.input.expanduser().resolve()
    output_root = arguments.output.expanduser().resolve()
    if not input_root.is_dir():
        print(f"ERROR: Input folder does not exist: {input_root}", file=sys.stderr)
        return 2
    if input_root == output_root:
        print("ERROR: Input and output folders must be different to protect source files.", file=sys.stderr)
        return 2

    try:
        ffmpeg = resolve_program(arguments.ffmpeg, "ffmpeg")
        ffprobe = resolve_program(arguments.ffprobe, "ffprobe")
    except RuntimeError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2

    sources = discover_videos(input_root, output_root)
    if not sources:
        print(f"No supported videos found in: {input_root}")
        return 0
    collisions = find_output_collisions(sources, input_root, output_root)
    if collisions:
        print("ERROR: Multiple source files would produce the same MP4 output:", file=sys.stderr)
        for path in collisions:
            print(f"  - {path}", file=sys.stderr)
        print("Rename the colliding source files and run the converter again.", file=sys.stderr)
        return 2

    profile = PROFILES[arguments.profile]
    crf = arguments.crf if arguments.crf is not None else profile.crf
    if not 16 <= crf <= 30:
        print("ERROR: --crf must be between 16 and 30.", file=sys.stderr)
        return 2

    print(f"Input:   {input_root}")
    print(f"Output:  {output_root}")
    print(f"Profile: {arguments.profile}, H.264 CRF {crf}, AAC {profile.audio_rate}, {arguments.preset} preset")
    print(f"Files:   {len(sources)}\n")

    converted = skipped = failed = 0
    started_at = time.monotonic()
    for index, source in enumerate(sources, start=1):
        destination = output_for(source, input_root, output_root)
        temporary_output: Path | None = None
        relative_name = source.relative_to(input_root)
        print(f"[{index}/{len(sources)}] {relative_name}")
        if destination.exists() and not arguments.overwrite:
            print("    SKIPPED: optimized output already exists")
            skipped += 1
            continue
        try:
            media = probe_media(ffprobe, source)
            print(
                f"    Source: {media.width}x{media.height}, "
                f"{media.fps:.2f} FPS, {format_duration(media.duration)}"
            )
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary_output = destination.with_name(f"{destination.stem}.part.mp4")
            command = make_command(
                ffmpeg, source, temporary_output, profile, arguments.preset, crf, media
            )
            if arguments.dry_run:
                print(f"    WOULD CREATE: {destination}")
                skipped += 1
                continue
            temporary_output.unlink(missing_ok=True)
            success, details = encode_video(command, media.duration, "Encoding")
            if not success:
                temporary_output.unlink(missing_ok=True)
                raise RuntimeError(details or "FFmpeg exited without creating the video")
            if not temporary_output.is_file() or temporary_output.stat().st_size == 0:
                temporary_output.unlink(missing_ok=True)
                raise RuntimeError("FFmpeg did not create a valid output file")
            os.replace(temporary_output, destination)
            source_mb = source.stat().st_size / 1024 / 1024
            output_mb = destination.stat().st_size / 1024 / 1024
            reduction = (1 - output_mb / source_mb) * 100 if source_mb else 0
            size_change = f"{reduction:.0f}% smaller" if reduction >= 0 else f"{-reduction:.0f}% larger"
            print(f"    CREATED: {destination} ({output_mb:.1f} MB, {size_change})")
            converted += 1
        except KeyboardInterrupt:
            if temporary_output:
                temporary_output.unlink(missing_ok=True)
            print("\nStopped by user. Source files were not changed.")
            return 130
        except Exception as error:  # Continue the batch and report every failed file.
            print(f"    FAILED: {error}", file=sys.stderr)
            failed += 1

    elapsed = format_duration(time.monotonic() - started_at)
    print(f"\nFinished in {elapsed}: {converted} converted, {skipped} skipped, {failed} failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
