"use strict";

const fs = require("fs");
const https = require("https");
const Stream = require("stream").Transform;
const SpotifyWebApi = require("spotify-web-api-node");
const Youtube = require("youtube-sr").default;
const ytdl = require("ytdl-core");
const ffmpeg = require("fluent-ffmpeg");
const ID3Writer = require("browser-id3-writer");

const PromiseEvent = require("./PromiseEvent.js");

// FORBIDDEN DIRECTORY AND FILE NAME CHARS //
const forbiddenDirChars = [
    "#",
    "%",
    "&",
    "{",
    "}",
    "\\",
    "/",
    "<",
    ">",
    "*",
    "?",
    "$",
    "!",
    "\'",
    "\"",
    ":",
    "@",
    "+",
    "\`",
    "|",
    "=",
    "/"
];

const correctedChars = {
    "&": "and"
};

var deleteForbidDirChars = (text) => {
    let correctedString = ""
    for (let char of text) {
        if (!forbiddenDirChars.includes(char)) {
            correctedString += char;
        } else if (correctedChars[char]) {
            correctedString += correctedChars[char];
        }
    }
    return correctedString;
}

// DELETE FILE //
var deleteFile = (filePath) => {
    try {
        fs.unlinkSync(filePath, (err) => {
            if (err) {
                if (err.code === "EBUSY") {
                    setTimeout(() => {
                        deleteFile(filePath);
                    }, 1000);
                } else {
                    console.log(`Error deleting ${filePath}: ${err}`);
                }
            }
        });
    } catch(err) {
        if (err) {
            if (err.code === "EBUSY") {
                setTimeout(() => {
                    deleteFile(filePath);
                }, 1000);
            } else {
                console.log(`Error deleting ${filePath}: ${err}`);
            }
        }
    }
}

// CREATE FOLDER //
var createFolder = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
}

// DOWNLOADER //
class Downloader {
    constructor(credentials, cwd) {
        this.credentials = credentials;
        this.cwd = cwd;
        this.spotifyApi = new SpotifyWebApi(credentials);

        this.retrieveToken();
        createFolder(`${this.cwd}\\.spot-dl`);

        return this;
    }

    status = "loading";
    queue = [];

    // RETRIEVE ACCESS TOKEN //
    retrieveToken = () => {
        this.spotifyApi.clientCredentialsGrant().then((data) => {
            this.spotifyApi.setAccessToken(data.body.access_token);
            this.status = "ready";
        }, (err) => {
            console.log(`Something went wrong when retrieving an access token: ${err.message}`);
            console.log("\nTry resetting your Spotify app credentials, run this command for more info:\n  spot-dl --help");
            this.status = "error";
        });
    }

    // DOWNLOAD TYPE (TRACK, PLAYLIST, ALBUM, ARTIST) //
    downloadType = {
        track: async (id, redownload) => {
            this.spotifyApi.getTrack(id).then((data) => {
                let download = this.downloadTrack(data.body, redownload);
                download.on("message", (message) => {
                    console.log(message);
                });
                download.then((downloadData) => {
                    console.log(downloadData.message);
                });
            }, (err) => {
                console.error(err);
            });
        },

        playlist: async (id, redownload) => {
            this.spotifyApi.getPlaylist(id).then((data) => {
                this.downloadPlaylist(data.body, redownload);
            }, (err) =>  {
                console.error(err);
            });
        },

        album: async (id, redownload, artistAlbum) => {
            this.spotifyApi.getAlbum(id).then((data) => {
                this.downloadAlbum(data.body, redownload, artistAlbum);
            }, (err) =>  {
                console.error(err);
            });
        },

        artist: async (id, redownload) => {
            this.spotifyApi.getArtistAlbums(id).then((data) => {
                this.downloadArtistAlbums(data.body, redownload);
            }, (err) =>  {
                console.error(err);
            });
        }
    };

    // DOWNLOAD //
    download = (url, redownload) => {
        if (this.status === "loading") {
            setTimeout(() => {
                this.download(url, redownload);
            }, 1000);
            return;
        } else if (this.status === "error") { return; }
        else if (this.status !== "ready") { return; }

        if (!url) {console.log("No Spotify URL provided!")};
        url = url.split("/");
        if (url[0] === "https:" && url[2] === "open.spotify.com") {
            if (this.downloadType[url[3]]) {
                let id = url[4].split("?")[0];
                if (!redownload) {
                    redownload = false;
                }
                this.downloadType[url[3]](id, redownload);
                createFolder(`${this.cwd}\\.spot-dl`);
            }
        }
    }

    // DOWNLOAD IMAGE //
    downloadImage = (title, artist, url) => {
        let downloader = this;
        let resolves;
        let promise = new PromiseEvent((resolve) => {
            resolves = resolve;
        });

        let fileName = `${artist} - ${title}`;
        if (fs.existsSync(`${downloader.cwd}\\.spot-dl\\${fileName}.jpg`)) {
            resolves({status: "end", alreadyDownloaded: true});
        } else {
            try {
                https.request(url, function(response) {
                    let data = new Stream();
                    response.on("data", function(chunk) {
                        data.push(chunk);
                        promise.emit("data", chunk);
                    });
                    response.on("end", function() {
                        fs.writeFileSync(`${downloader.cwd}\\.spot-dl\\${fileName}.jpg`, data.read());
                        resolves({status: "end", message: "--> downloaded thumbnail"});
                    });
                }).end();
            } catch (err) {
                console.error(err);
            }
        }

        return promise;
    }

    // APPLY METADATA //
    applyMetadata = (data) => {
        let downloader = this;
        let resolves;
        let promise = new PromiseEvent((resolve) => {
            resolves = resolve;
        });

        let artists = data.artists;
        let title = data.name;
        let album = data.album.name;
        let albumArtistName = data.album.artists[0].name;
        let song = data.track_number;
        let disc = data.disc_number;
        let artistWebsite = artists[0].external_urls.spotify;
        let audioWebsite = data.external_urls.spotify;
        let length = data.duration_ms;
        let release = data.album.release_date.split("-");
        let releaseDate = `${release[1]}${release[2]}`;
        let releaseYear = release[0];
        let query = `${artists[0].name} - ${title}`;
        let finalFilePath = `${downloader.cwd}\\${query}.mp3`;
        let rawFilePath = `${downloader.cwd}\\.spot-dl\\${query}_raw.mp3`;
        let imagePath = `${downloader.cwd}\\.spot-dl\\${albumArtistName} - ${album}.jpg`;
        // create track metadata
        let metadata = {
            TPE1: [],
            TIT2: title,
            TALB: album,
            TPE2: albumArtistName,
            TRCK: song,
            TPOS: disc,
            WOAF: audioWebsite,
            WOAR: artistWebsite,
            WOAS: audioWebsite,
            TLEN: length,
            TDAT: releaseDate,
            TYER: releaseYear,
            APIC: {
                type: 3,
                data: fs.readFileSync(imagePath),
                description: "thumbnail"
            }
        };
        // add contributing artists
        for (let i = 0; i < artists.length; i++) {
            metadata.TPE1.push(artists[i].name);
        }
        // write track metadata
        let rawFile = fs.readFileSync(rawFilePath);
        let writer = new ID3Writer(rawFile);
        for (let tag in metadata) {
            writer.setFrame(tag, metadata[tag]);
        }
        writer.addTag();
        let taggedSongBuffer = Buffer.from(writer.arrayBuffer);
        fs.writeFile(finalFilePath, taggedSongBuffer, {flag: "w"}, (err) => {
            if (err) {
                console.log(`Error writing ${finalFilePath}: ${err}`);
                resolves({status: "error", message: err});
            } else {
                resolves({status: "done", message: "--> applied metadata"});
            }
        });

        return promise;
    }

    // DOWNLOAD QUEUE //
    downloadQueue = (length) => {
        let downloading = {};
        for (let i = 0; i < length; i++) {
            if (!this.queue[i]) { return; }
            let track = this.queue[i];
            downloading[i] = this.downloadTrack(track.data, track.redownload);
            downloading[i].on("message", (message) => {
                console.log(message);
            });
            downloading[i].then((downloadData) => {
                console.log(downloadData.message);
            });
        }

        let indexes = Object.keys(downloading);
        downloading[indexes[indexes.length - 1]].then(() => {
            for (let i = 0; i < length; i++) {
                if (!this.queue[i]) { return; }
                this.queue.splice(i, 1);
            }
            if (this.queue.length !== 0) {
                this.downloadQueue(length);
            }
        })
    }

    // DOWNLAOD TRACK //
    downloadTrack = (data, redownload) => {
        let downloader = this;
        let resolves;
        let promise = new PromiseEvent((resolve) => {
            resolves = resolve;
        });

        data.name = deleteForbidDirChars(data.name);
        data.artists[0].name = deleteForbidDirChars(data.artists[0].name);
        data.album.name = deleteForbidDirChars(data.album.name);
        let artists = data.artists;
        let title = data.name;
        let query = `${artists[0].name} - ${title}`;
        // search youtube track
        let ytSearch = Youtube.searchOne(query);
        ytSearch.then((ytSearchData) => {
            // download track
            promise.emit("message", `Starting download ${query}`);
            let audio = ytdl(ytSearchData.url, { filter: "audioonly", quality: "highestaudio" });
            promise.emit("message", "--> downloaded audio");
            let ffmpegProcess = ffmpeg(audio);
            ffmpegProcess.toFormat("mp3");
            ffmpegProcess.audioBitrate(320);
            ffmpegProcess.on("error", console.error);
            ffmpegProcess.on("end", function() {
                promise.emit("message", "--> converted audio");
                // add image
                downloader.downloadImage(data.album.name, data.album.artists[0].name, data.album.images[0].url)
                    .then((imageData) => {
                        if (imageData.status === "end") {
                            if (!imageData.alreadyDownloaded) {
                                promise.emit("message", imageData.message);
                            }
                            // apply metadata
                            downloader.applyMetadata(data)
                                .then((applyData) => {
                                    if (applyData.status === "done") {
                                        promise.emit("message", applyData.message);
                                        deleteFile(`${downloader.cwd}\\.spot-dl\\${query}_raw.mp3`);
                                        resolves({message: `--> Downloaded ${query}`});
                                    }
                                });
                        }
                    });
            });
            ffmpegProcess.save(`${downloader.cwd}\\.spot-dl\\${query}_raw.mp3`);
        });

        return promise;
    }

    // DOWNLOAD PLAYLIST //
    downloadPlaylist = (data, redownload) => {
        data.tracks.items.forEach((item, index) => {
            let track = {
                data: item.track,
                redownload: redownload
            }
            this.queue.push(track);
        });
        this.downloadQueue(1);
    }

    // DOWNLOAD ALBUM //
    downloadAlbum = (data, redownload, artistDownload) => {
        data.tracks.items.forEach((item, index) => {
            item.album = {};
            for (let property in data) {
                if (property !== "tracks") {
                    item.album[property] = data[property];
                }
            }
            let track = {
                data: item,
                redownload: redownload
            }
            this.queue.push(track);
        });
        if (!artistDownload) {
            this.downloadQueue(1);
        }
    }

    // DOWNLOAD ARTIST ALBUMS //
    downloadArtistAlbums = (data, redownload) => {
        data.items.forEach((item, index) => {
            this.downloadType.album(item.id, redownload, (index === 0) ? false : true);
        });
    }
}

module.exports = Downloader;