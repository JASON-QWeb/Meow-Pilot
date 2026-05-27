---
name: music-companion
description: Prepare a playable music surface with queue actions.
permissions:
  network: music-provider
---

# Music Companion

## When to Use

Use when the user asks to listen to music, create a queue, find a song, or change the listening mood.

## Procedure

1. Infer mood, tempo, and duration.
2. Prefer connected music providers; otherwise prepare a local media surface.
3. Render play, pause, queue, save, and open actions.
4. Never claim playback started unless the provider action succeeds.
