# spot-dl-downloader
A module for [spot-dl](https://www.npmjs.com/package/spot-dl).

## Usage

Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/applications)
and create an app.

Copy the `clientId` and the `clientSecret`.

Please note that without the credentials
you can't use this tool.

```js
const spotdlDownloader = require("spot-dl-downloader");

let credentials = {
    "clientId": "<client id>",
    "clientSecret": "<client secret>"
}

new spotdlDownloader(credentials, "<dir path>")
    .download("<spotify url>");
```

-   `spotify url`<br>
    Could be the URL of an album, track, playlist.
    Or even an artist.

    Entering the URL to an artist will download all the songs
    created by the artists.

-   `dir path`<br>
    Path to the directory where the songs will be downloaded.
    Can even be `process.cwd()` (trick used in [spot-dl](https://www.npmjs.com/package/spot-dl)).

Very simple to use, I think...

## Example

Here's a complete example (except for the `credentials`)
of how to download a song.

```js
const spotdlDownloader = require("spot-dl-downloader");

let credentials = {
    "clientId": "<client id>",
    "clientSecret": "<client secret>"
}

new spotdlDownloader(credentials, __dirname)
    .download("https://open.spotify.com/track/7JJmb5XwzOO8jgpou264Ml?si=387fb90dc9414285");
```