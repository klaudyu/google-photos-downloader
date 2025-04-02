// Updated version using auth.request() directly for Photos API
const fs = require("fs");
const path = require("path");
const moment = require("moment");
const mkdirp = require("mkdirp");
const filecompare = require("filecompare");

const { MEDIA_ITEMS_ROOT } = require("../config");

const getUniqueFilePath = filePath => {
    const parsed = path.parse(filePath);
    const parenRegex = /(?<=\()[^)]+(?=\))/;
    const match = parsed.name.match(parenRegex);

    if (match) {
        parsed.name = parsed.name.replace(parenRegex, parseInt(match) + 1);
    } else {
        parsed.name += " (1)";
    }
    parsed.base = parsed.name + parsed.ext;
    return path.format(parsed);
};

const writeFileSyncSafely = (filePath, data) => {
    let newPath;
    if (fs.existsSync(filePath)) {
        newPath = getUniqueFilePath(filePath);
        writeFileSyncSafely(newPath, data);
        filecompare(filePath, newPath, isEqual => {
            if (isEqual) {
                fs.unlinkSync(newPath);
                console.log("Removed duplicate file", newPath);
            }
        });
    } else {
        fs.writeFileSync(filePath, data);
        console.log("Successfully wrote file", filePath);
    }
};

const downloadMediaItem = async (auth, mediaItem, directory) => {
    const param = mediaItem.mediaMetadata.video ? "=dv" : "=d";
    const mediaUrl = mediaItem.baseUrl + param;
    const filePath = `${directory}/${mediaItem.filename}`;

    try {
        const response = await auth.request({
            url: mediaUrl,
            method: "GET",
            responseType: "arraybuffer"
        });
        writeFileSyncSafely(filePath, Buffer.from(response.data));
    } catch (err) {
        console.error("Failed to download media:", mediaItem.filename, err);
    }
};

const processMediaItem = async (auth, mediaItem) => {
    const creationTime = moment(mediaItem.mediaMetadata.creationTime);
    const year = creationTime.format("YYYY");
    const month = creationTime.format("MM");
    const dir = `${MEDIA_ITEMS_ROOT}/${year}/${month}`;
    const filePath = `${dir}/${mediaItem.filename}`;

    mkdirp.sync(dir);

    if (fs.existsSync(filePath)) {
        console.log("Skipping already downloaded file:", filePath);
        return;
    }

    await downloadMediaItem(auth, mediaItem, dir);
};

const processMediaItemsPage = async (auth, response) => {
    const mediaItems = response.mediaItems || [];
    const nextPageToken = response.nextPageToken;
    let firstItem = true;

    for (const item of mediaItems) {
        if (firstItem && !response._pageToken) {
            fs.writeFileSync(global.SYNC_STOP_PATH, item.id);
            console.log(item.id, "marked as sync stop");
        }
        await processMediaItem(auth, item);
        firstItem = false;
    }

    if (nextPageToken) {
        await getMediaItemsPage(auth, nextPageToken);
    }
};

const getMediaItemsPage = async (auth, pageToken = null) => {
    const url = new URL("https://photoslibrary.googleapis.com/v1/mediaItems");
    if (pageToken) url.searchParams.append("pageToken", pageToken);

    try {
        const res = await auth.request({
            url: url.toString(),
            method: "GET"
        });
        const parsed = res.data;
        parsed._pageToken = pageToken;
        await processMediaItemsPage(auth, parsed);
    } catch (err) {
        console.error("Photos API request failed:", err.response?.data || err.message);
    }
};

const setSyncStop = () => {
    global.SYNC_STOP_PATH = path.resolve(__dirname, "../sync-stop.txt");
    try {
        global.STOP_AT = fs.readFileSync(global.SYNC_STOP_PATH).toString();
    } catch (err) {
        console.log("Did not find sync-stop.txt. Continuing...");
    }
};

const downloadMedia = auth => {
    setSyncStop();
    getMediaItemsPage(auth);
};

module.exports = { downloadMedia, getUniqueFilePath };
