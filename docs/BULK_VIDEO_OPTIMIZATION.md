# Bulk lecture video optimization

The converter creates browser-compatible MP4 files using H.264 video, AAC audio, a maximum of 30 FPS, two-second keyframes and MP4 Fast Start. Source files are never modified.

## Install requirements on Windows

Install Python 3 and FFmpeg, then open a new PowerShell window:

```powershell
winget install Python.Python.3.12
winget install Gyan.FFmpeg
```

Verify both applications:

```powershell
python --version
ffmpeg -version
ffprobe -version
```

## Convert a folder

For normal camera lectures and the smallest practical files:

```powershell
python scripts/bulk_optimize_videos.py "D:\ADCI Raw Videos" "D:\ADCI Optimized Videos" --profile 720p
```

For lectures containing slides or small text:

```powershell
python scripts/bulk_optimize_videos.py "D:\ADCI Raw Videos" "D:\ADCI Optimized Videos" --profile 1080p
```

The script searches all subfolders and recreates the same folder structure under the output directory. Existing outputs are skipped, so an interrupted batch can be safely started again.

Preview the planned work without converting anything:

```powershell
python scripts/bulk_optimize_videos.py "D:\ADCI Raw Videos" "D:\ADCI Optimized Videos" --profile 720p --dry-run
```

Replace existing optimized copies only when required:

```powershell
python scripts/bulk_optimize_videos.py "D:\ADCI Raw Videos" "D:\ADCI Optimized Videos" --profile 720p --overwrite
```

Use `--preset slow` for slightly smaller files when conversion time is not important. Use `--preset fast` on a slower computer. Run `python scripts/bulk_optimize_videos.py --help` for every option.

## Recommended workflow

1. Keep raw recordings in a separate backup folder.
2. Run `--dry-run` first.
3. Convert one short video and inspect its slides, speech and seeking behavior.
4. Convert the complete folder.
5. Upload only files from the optimized output folder to the LMS.
