# Pulse

A dark, fully customisable desktop music player for **YouTube**, **YouTube Music** and **SoundCloud**.

- Paste any YouTube / YouTube Music / SoundCloud link into the search bar and press Enter to play it
- Search YouTube, YouTube Music or SoundCloud with the pills at the top right
- Queue, liked songs, recently played, shuffle, repeat, seek and volume
- Customise everything: 6 preset themes, every colour, corner roundness, spacing, font, compact rows, hide the side panel
- Focus mode (⤢) makes the video or artwork fill the window
- Keyboard: Space = play/pause, Ctrl+→ / Ctrl+← = next/previous, Esc = leave focus mode

Songs play through YouTube's and SoundCloud's official embedded players, so it stays within their rules. Nothing gets downloaded.

## Download

Go to the **Releases** section on the right-hand side of this page and download:

- **Windows:** `Pulse Setup x.x.x.exe`
- **Mac:** `Pulse-x.x.x.dmg`
- **Linux:** `Pulse-x.x.x.AppImage`

Windows may show "Windows protected your PC" the first time, because the app isn't code-signed. Click **More info**, then **Run anyway**.
On a Mac, right-click the app, choose **Open**, then click **Open** again.

## Searching (optional)

You can paste links without any setup. Searching inside the app needs a free key:

**YouTube / YouTube Music:**
1. Go to https://console.cloud.google.com and sign in.
2. Create a project.
3. Search for **YouTube Data API v3** and click **Enable**.
4. Go to **Credentials**, choose **Create credentials**, then **API key**, and copy the key.
5. In Pulse, click ⚙ and paste it into **YouTube API key**.

**SoundCloud:** SoundCloud isn't currently giving out new API keys. If you have a client ID, paste it in ⚙. If not, pasting SoundCloud links works fine.

## Running from source (for developers)

```bash
npm install
npm start
```
