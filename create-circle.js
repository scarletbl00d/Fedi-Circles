/**
 *
 * @param {RequestInfo | URL} url
 * @param {{ body?: any } & RequestInit?} options
 */
async function apiRequestWithHeaders(url, options = null)
{
    console.log(`Fetching :: ${url}`);

    if (options && options.body) {
        options.body = JSON.stringify(options.body);
    }

    return await fetch(url, options ?? {})
        .then(response => {
            if (response.ok) {
                return response;
            }

            throw new Error(`Error fetching ${url}: ${response.status} ${response.statusText}`);
        })
        .then(response => new Promise((resolve, reject) => {
            response.json()
            .then(rbody => resolve({headers: response.headers, body: rbody}))
            .catch(error => reject(error))
        }))
        .catch(error => {
            console.error(`Error fetching ${url}: ${error}`);
            return null;
        });
}

/**
 *
 * @param {RequestInfo | URL} url
 * @param {{ body?: any } & RequestInit?} options
 */
async function apiRequest(url, options = null)
{
    const reply = await apiRequestWithHeaders(url, options);
    return reply?.body;
}

function Handle(name, instance) {
    let handleObj = Object.create(Handle.prototype);
    handleObj.name = name;
    handleObj.instance = instance;
    handleObj._baseInstance = null;
    handleObj._apiInstance = null;
    handleObj.profileUrl = null;

    return handleObj;
}

Object.defineProperty(Handle.prototype, "baseInstance", {
    get: function () {
        return this._baseInstance || this.instance;
    }
});

Object.defineProperty(Handle.prototype, "apiInstance", {
    get: function () {
        return this._apiInstance || this.instance;
    }
});

Object.defineProperty(Handle.prototype, "baseHandle", {
    get: function () {
        return this.name + "@" + this.baseInstance;
    }
});

Handle.prototype.toString = function () {
    return this.name + "@" + this.instance;
};

/**
 * @returns {Promise<Handle>} The handle WebFingered, or the original on fail
 */
Handle.prototype.webFinger = async function () {
    if (this._baseInstance) {
        return this;
    }

    let url = `https://${this.instance}/.well-known/webfinger?` + new URLSearchParams({
        resource: `acct:${this}`
    });

    let webFinger = await apiRequest(url);

    if (!webFinger)
        return this;

    let acct = webFinger["subject"];

    if (typeof acct !== "string")
        return this;

    if (acct.startsWith("acct:")) {
        acct = acct.substring("acct:".length);
    }

    let baseHandle = parseHandle(acct);
    baseHandle._baseInstance = baseHandle.instance;
    baseHandle.instance = this.instance;

    const links = webFinger["links"];

    if (!Array.isArray(links)) {
        return baseHandle;
    }

    const selfLink = links.find(link => link["rel"] === "self");
    if (!selfLink) {
        return baseHandle;
    }

    try {
        const url = new URL(selfLink["href"])
        baseHandle._apiInstance = url.hostname;
    } catch (e) {
        console.error(`Error parsing WebFinger self link ${selfLink["href"]}: ${e}`);
    }

    const profileLink = links.find(link => link["rel"] === "http://webfinger.net/rel/profile-page");
    if (profileLink?.["href"]) {
        try {
            baseHandle.profileUrl = new URL(profileLink["href"]);
        } catch (e) {
            console.error(`Error parsing WebFinger profile page link ${profileLink["href"]}: ${e}`);
        }
    }

    return baseHandle;
};


/**
 * @typedef {{
 *    id: string,
 *    avatar: string,
 *    bot: boolean,
 *    name: string,
 *    handle: Handle,
 * }} FediUser
 */

/**
 * @typedef {FediUser & {conStrength: number}} RatedUser
 */

/**
 * @typedef {{
 *    id: string,
 *    replies: number,
 *    renotes: number,
 *    favorites: number,
 *    extra_reacts: boolean,
 *    instance: string,
 *    author?: FediUser,
 * }} Note
 */

class ApiClient {
    /**
     * @param {string} instance
     */
    constructor(instance) {
        this._instance = instance;
        // How many objects to max consider per type
        this._CNT_NOTES = 70;
        this._CNT_RENOTES = 50;
        this._CNT_REPLIES = 100;
        this._CNT_FAVS = 100;
    }

    /**
     *
     * @param instance
     * @returns {Promise<ApiClient>}
     */
    static async getClient(instance) {
        if (instanceTypeCache.has(instance)) {
            return instanceTypeCache.get(instance);
        }

        let url = `https://${instance}/.well-known/nodeinfo`;
        let nodeInfo = await apiRequest(url);

        if (!nodeInfo || !Array.isArray(nodeInfo.links)) {
            const client = new MastodonApiClient(instance, true);
            instanceTypeCache.set(instance, client);
            return client;
        }

        const { links } = nodeInfo;

        let apiLink = links.find(link => link.rel === "http://nodeinfo.diaspora.software/ns/schema/2.1");
        if (!apiLink) {
            apiLink = links.find(link => link.rel === "http://nodeinfo.diaspora.software/ns/schema/2.0");
        }

        if (!apiLink) {
            console.error(`No NodeInfo API found for ${instance}}`);
            const client = new MastodonApiClient(instance, true);
            instanceTypeCache.set(instance, client);
            return client;
        }

        let apiResponse = await apiRequest(apiLink.href);

        if (!apiResponse) {
            // Guess from API endpoints
            const misskeyMeta = await apiRequest(`https://${instance}/api/meta`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: {}
            });

            if (misskeyMeta) {
                const client = new MisskeyApiClient(instance);
                instanceTypeCache.set(instance, client);
                return client;
            }

            const client = new MastodonApiClient(instance, true);
            instanceTypeCache.set(instance, client);
            return client;
        }

        let { software } = apiResponse;
        software.name = software.name.toLowerCase();

        if (software.name.includes("fedibird")) {
            const client = new FedibirdApiClient(instance, true);
            instanceTypeCache.set(instance, client);
            return client;
        }

        if (software.name.includes("misskey") ||
            software.name.includes("calckey") ||
            software.name.includes("foundkey") ||
            software.name.includes("magnetar") ||
            software.name.includes("firefish")) {
            const client = new MisskeyApiClient(instance);
            instanceTypeCache.set(instance, client);
            return client;
        }

        let features = apiResponse?.metadata?.features;
        if (Array.isArray(features) && features.includes("pleroma_api")) {
            const has_emoji_reacts = features.includes("pleroma_emoji_reactions");
            const client = new PleromaApiClient(instance, has_emoji_reacts);
            instanceTypeCache.set(instance, client);
            return client;
        }

        const client = new MastodonApiClient(instance, true);
        instanceTypeCache.set(instance, client);
        return client;
    }

    /**
     * @param {Handle} handle
     *
     * @returns {Promise<FediUser>}
     */
    async getUserIdFromHandle(handle){ throw new Error("Not implemented"); }

    /**
     * @param {FediUser} user
     *
     * @returns {Promise<Note[]>}
     */
    async getNotes(user){ throw new Error("Not implemented"); }

    /**
     * @param {Note} note
     *
     * @returns {Promise<FediUser[] | null>}
     */
    async getRenotes(note){ throw new Error("Not implemented"); }

    /**
     * @param {Note} note
     *
     * @returns {Promise<Note[] | null>}
     */
    async getReplies(note){ throw new Error("Not implemented"); }

    /**
     * @param {Note} note
     *
     * @returns {Promise<FediUser[] | null>}
     */
    async getReactions(note){ return []; }

    /**
     * @param {Note} note
     *
     * @returns {Promise<FediUser[] | null>}
     */
    async getFavs(note) { throw new Error("Not implemented"); }

    /**
     * @param {Note} note
     * @param {boolean} extra_reacts Also include emoji reacts
     *
     * @return {Promise<FediUser[] | null>}
     */
    async getConsolidatedReactions(note, extra_reacts = false){
        let favs = await this.getFavs(note);

        if (!extra_reacts)
            return favs;

        /**
         * @type {Map<string, FediUser>}
         */
        let users = new Map();
        if (favs !== null) {
            favs.forEach(u => {
                users.set(u.id, u);
            });
        }

        const reactions = await this.getReactions(note);
        if (reactions !== null) {
            reactions.forEach(u => {
                users.set(u.id, u);
            });
        }


        return Array.from(users.values());
    }

    /**
     * @returns string
     */
    getClientName() { throw new Error("Not implemented"); }
}

class MastodonApiClient extends ApiClient {
    /**
     * @param {string} instance
     * @param {boolean} emoji_reacts
     * @param {MastodonApiClient} flavor
     */
    constructor(instance, emoji_reacts, flavor = MastodonFlavor.MASTODON) {
        super(instance);
        this._emoji_reacts = emoji_reacts;
        this._flavor = flavor;
        // Server-side hard limits on return items; varies per endpoint
        this._API_LIMIT = 80;
        this._API_LIMIT_SMALL = 40;
    }

    /**
     * @param {Headers} headers
     * @return {URL | null} request URL for next page or null
     */
    static getNextPage(headers)
    {
        /*
         * https://docs.joinmastodon.org/api/guidelines/#pagination
         *
         * Not explicitly documented in the page linked above, but
         *  - the next page will automatically use the same limit as the original request
         *    (tested with Mastodon 4.2.1 and Akkoma 3.10.3)
         *  - the last page can sometimes still contain a next/prev link, but this "next" page
         *    will then be empty and not contain any Link header (e.g. Akkoma 3.10.3 with statuses)
         *    To save on API requests, we can check if less than expected were returned
         */
        const links = headers.get("Link");
        if (links === null)
            return null;

        for (const link of links.split(",")) {
            const [url_raw, rel] = link.split(";").map(s => s.trim());
            if (url_raw && rel === 'rel="next"') {
                try {
                    // Remove enclosing angle brackets <...>
                    return new URL(url_raw.substring(1, url_raw.length - 1));
                } catch (e) {
                    console.warn("Invalid URL: ", e);
                }
            }
        }

        return null;
    }

    /**
     * @param {RequestInfo | URL} url
     * @param {number} targetCount how many entries to gather
     * @param {number?} requestLimit how many entries a single request is expected to return.
     *                  If set will be used to detect end of data early, without needing to request an empty page.
     * @param {boolean} exactTarget if true, discard entries exceeding targetCount
     */
    static async apiRequestPaged(url, targetCount, requestLimit = null, exactTarget = false)
    {
        console.log(`Fetching repeatedly (${targetCount} a ${requestLimit}) :: ${url}`);

        let nextUrl = url;
        let remaining = targetCount;
        let data = [];
        while (remaining > 0 && nextUrl !== null) {
            const reply = await apiRequestWithHeaders(nextUrl);
            if (reply?.body === null) {
                console.error(`Error while gathering entries. Returning incomplete data!`);
                break;
            }
            nextUrl = MastodonApiClient.getNextPage(reply.headers);
            let newdata = reply.body;
            if (exactTarget && newdata.length > remaining)
                newdata = newdata.slice(0, remaining);

            data.push(newdata);
            remaining -= newdata.length;
            if (newdata.length < requestLimit)
                break;
        }

        return data.length === 0 ? null : data.flat();
    }

    async getUserIdFromHandle(handle) {
        const url = `https://${this._instance}/api/v1/accounts/lookup?acct=${handle.baseHandle}`;
        let response = await apiRequest(url, null);

        if (!response) {
            const url = `https://${this._instance}/api/v1/accounts/lookup?acct=${handle}`;
            response = await apiRequest(url, null);
        }

        if (!response) {
            return null;
        }

        return {
            id: response.id,
            avatar: response.avatar,
            bot: response.bot,
            name: response["display_name"],
            handle: handle,
        };
    }

    async getNotes(user) {
        const url = `https://${this._instance}/api/v1/accounts/${user.id}/statuses?exclude_replies=true&exclude_reblogs=true&limit=${this._API_LIMIT_SMALL}`;
        const response = await MastodonApiClient.apiRequestPaged(url, this._CNT_NOTES, this._API_LIMIT_SMALL, true);

        if (!response) {
            return null;
        }

        if (response?.some(note => note?.["pleroma"]?.["emoji_reactions"]?.length)) {
            this._flavor = MastodonFlavor.PLEROMA;
        } else if (response?.some(note => note?.["emoji_reactions"]?.length)) {
            this._flavor = MastodonFlavor.FEDIBIRD;
        }

        return response.map(note => ({
            id: note.id,
            replies: note["replies_count"] || 0,
            renotes: note["reblogs_count"] || 0,
            favorites: note["favourites_count"],
            extra_reacts: note?.["emoji_reactions"]?.length > 0 || note?.["pleroma"]?.["emoji_reactions"]?.length > 0,
            instance: this._instance,
            author: user
        }));
    }

    async getRenotes(note) {
        const url = `https://${this._instance}/api/v1/statuses/${note.id}/reblogged_by?limit=${this._API_LIMIT}`;
        const response = await MastodonApiClient.apiRequestPaged(url, this._CNT_RENOTES, this._API_LIMIT);

        if (!response) {
            return null;
        }

        return response.map(user => ({
            id: user.id,
            avatar: user.avatar,
            bot: user.bot,
            name: user["display_name"],
            handle: parseHandle(user["acct"], note.instance)
        }));
    }

    async getReplies(noteIn) {
        // The context endpoint has no limit parameter or pages
        const url = `https://${this._instance}/api/v1/statuses/${noteIn.id}/context`;
        const response = await apiRequest(url);

        if (!response) {
            return null;
        }

        if (response["descendants"]?.some(note => note?.["pleroma"]?.["emoji_reactions"]?.length)) {
            this._flavor = MastodonFlavor.PLEROMA;
        } else if (response["descendants"]?.some(note => note?.["emoji_reactions"]?.length)) {
            this._flavor = MastodonFlavor.FEDIBIRD;
        }

        return response["descendants"].map(note => {

            let handle = parseHandle(note["account"]["acct"], noteIn.instance);

            return {
                id: note.id,
                replies: note["replies_count"] || 0,
                renotes: note["reblogs_count"] || 0,
                favorites: note["favourites_count"],
                extra_reacts: note?.["emoji_reactions"]?.length > 0 || note?.["pleroma"]?.["emoji_reactions"]?.length > 0,
                instance: handle.instance,
                author: {
                    id: note["account"]["id"],
                    bot: note["account"]["bot"],
                    name: note["account"]["display_name"],
                    avatar: note["account"]["avatar"],
                    handle: handle
                }
            };
        });
    }

    async getFavs(note) {
        const url = `https://${this._instance}/api/v1/statuses/${note.id}/favourited_by?limit=${this._API_LIMIT}`;
        const response = await MastodonApiClient.apiRequestPaged(url, this._CNT_FAVS, this._API_LIMIT);

        if (!response) {
            return null;
        }

        return response.map(user => ({
            id: user.id,
            avatar: user.avatar,
            bot: user.bot,
            name: user["display_name"],
            handle: parseHandle(user["acct"], note.instance)
        }));
    }

    async getReactions(note) {
        if (this._flavor === MastodonFlavor.MASTODON) {
            return [];
        }

        return this._flavor.getReactions.call(this, note);
    }

    getClientName() {
        return "mastodon";
    }
}

class PleromaApiClient extends MastodonApiClient {
    /**
     * @param {string} instance
     * @param {boolean} emoji_reacts
     */
    constructor(instance, emoji_reacts) {
        super(instance, emoji_reacts, MastodonFlavor.PLEROMA);
    }

    async getReactions(note) {
        if (!this._emoji_reacts)
            return [];

        // The documentation doesn't specify the hardcoded limit, so just use the lowest known one
        const url = `https://${this._instance}/api/v1/pleroma/statuses/${note.id}/reactions?limit=${this._API_LIMIT_SMALL}`;
        const response = await MastodonApiClient.apiRequestPaged(url, this._CNT_FAVS, this._API_LIMIT_SMALL) ?? [];

        /**
         * @type {Map<string, FediUser>}
         */
        const users = new Map();

        for (const reaction of response) {
            reaction["accounts"]
                .map(account => ({
                    id: account["id"],
                    avatar: account["avatar"],
                    bot: account["bot"],
                    name: account["display_name"],
                    handle: parseHandle(account["acct"], note.instance)
                }))
                .forEach(u => {
                    if(!users.has(u.id))
                        users.set(u.id, u);
                })
        }

        return Array.from(users.values());
    }

    getClientName() {
        return "pleroma";
    }
}

class FedibirdApiClient extends MastodonApiClient {
    /**
     * @param {string} instance
     * @param {boolean} emoji_reacts
     */
    constructor(instance, emoji_reacts) {
        super(instance, emoji_reacts, MastodonFlavor.FEDIBIRD);
    }

    async getReactions(note) {
        if (!this._emoji_reacts)
            return [];

        /**
         * @type {Map<string, FediUser>}
         */
        let users = new Map();

        // Could not locate documentation for Fedibird API, so just use lowest known limit
        const url = `https://${this._instance}/api/v1/statuses/${note.id}/emoji_reactioned_by?limit=${this._API_LIMIT_SMALL}`;
        const response = await MastodonApiClient.apiRequestPaged(url, this._CNT_FAVS, this._API_LIMIT_SMALL) ?? [];

        for (const reaction of response) {
            let account = reaction["account"];
            let u = {
                id: account["id"],
                avatar: account["avatar"],
                bot: account["bot"],
                name: account["display_name"],
                handle: parseHandle(account["acct"], note.instance)
            }

            if(!users.has(u.id))
                users.set(u.id, u);
        }

        return Array.from(users.values());
    }

    getClientName() {
        return "fedibird";
    }
}

const MastodonFlavor = {
    MASTODON: MastodonApiClient.prototype,
    PLEROMA: PleromaApiClient.prototype,
    FEDIBIRD: FedibirdApiClient.prototype,
};

class MisskeyApiClient extends ApiClient {
    /**
     * @param {string} instance
     */
    constructor(instance) {
        super(instance);
    }

    async getUserIdFromHandle(handle) {
        const lookupUrl = `https://${this._instance}/api/users/search-by-username-and-host`;
        const lookup = await apiRequest(lookupUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                username: handle.name,
                host: null
            }
        });

        let id = null;

        for (const user of Array.isArray(lookup) ? lookup : []) {
            const isLocal = user?.["host"] === handle.instance ||
                user?.["host"] === handle.baseInstance ||
                this._instance === handle.apiInstance && user?.["host"] === null;

            if (isLocal && user?.["username"] === handle.name && user["id"]) {
                id = user["id"];
                break;
            }
        }

        const url = `https://${this._instance}/api/users/show`;
        const response = await apiRequest(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                id: id ? id : undefined,
                username: handle.name
            }
        });

        if (!response) {
            return null;
        }

        return {
            id: response.id,
            avatar: response["avatarUrl"],
            bot: response["isBot"],
            name: response["name"],
            handle: handle,
        };
    }

    async getNotes(user) {
        const url = `https://${this._instance}/api/users/notes`;
        const response = await apiRequest(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                userId: user.id,
                limit: this._CNT_NOTES,
                reply: false,
                renote: false,
            }
        });

        if (!response) {
            return null;
        }

        return response.map(note => ({
            id: note.id,
            replies: note["repliesCount"],
            renotes: note["renoteCount"],
            favorites: Object.values(note["reactions"]).reduce((a, b) => a + b, 0),
            extra_reacts: false,
            instance: this._instance,
            author: user
        }));
    }

    async getRenotes(note) {
        const url = `https://${this._instance}/api/notes/renotes`;
        const response = await apiRequest(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                noteId: note.id,
                limit: this._CNT_RENOTES,
            }
        });

        if (!response) {
            return null;
        }

        return response.map(renote => ({
            id: renote["user"]["id"],
            avatar: renote["user"]["avatarUrl"],
            bot: renote["user"]["isBot"] || false,
            name: renote["user"]["name"],
            handle: parseHandle(renote["user"]["username"], renote["user"]["host"] ?? this._instance)
        }));
    }

    async getReplies(note) {
        const url = `https://${this._instance}/api/notes/replies`;
        const response = await apiRequest(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                noteId: note.id,
                limit: this._CNT_REPLIES,
            }
        });

        if (!response) {
            return null;
        }

        return response.map(reply => {
            const handle = parseHandle(reply["user"]["username"], reply["user"]["host"] ?? this._instance);

            return {
                id: reply.id,
                replies: reply["repliesCount"],
                renotes: reply["renoteCount"],
                favorites: Object.values(reply["reactions"]).reduce((a, b) => a + b, 0),
                extra_reacts: false,
                instance: handle.instance,
                author: {
                    id: reply["user"]["id"],
                    avatar: reply["user"]["avatarUrl"],
                    bot: reply["user"]["isBot"] || false,
                    name: reply["user"]["name"],
                    handle: handle
                }
            };
        });
    }

    async getFavs(note) {
        const url = `https://${this._instance}/api/notes/reactions`;
        const response = await apiRequest(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                noteId: note.id,
                limit: this._CNT_FAVS,
            }
        });

        if (!response) {
            return null;
        }

        return response.map(reaction => ({
            id: reaction["user"]["id"],
            avatar: reaction["user"]["avatarUrl"],
            bot: reaction["user"]["isBot"] || false,
            name: reaction["user"]["name"],
            handle: parseHandle(reaction["user"]["username"], reaction["user"]["host"] ?? this._instance),
        }));
    }

    getClientName() {
        return "misskey";
    }
}

/** @type {Map<string, ApiClient>} */
let instanceTypeCache = new Map();

/**
 * @param {string} fediHandle
 * @param {string} fallbackInstance
 *
 * @returns {Handle}
 */
function parseHandle(fediHandle, fallbackInstance = "") {
    if (fediHandle.charAt(0) === '@')
        fediHandle = fediHandle.substring(1);

    fediHandle = fediHandle.replaceAll(" ", "");
    const [name, instance] = fediHandle.split("@", 2);

    return new Handle(name, instance || fallbackInstance);
}

async function circleMain() {
    let progress = document.getElementById("outInfo");

    const generateBtn = document.getElementById("generateButton");

    generateBtn.style.display = "none";

    let fediHandle = document.getElementById("txt_mastodon_handle");
    const selfUser = await parseHandle(fediHandle.value).webFinger();

    let form = document.getElementById("generateForm");
    let backend = form.backend;
    for (const radio of backend) {
        radio.disabled = true;
    }

    fediHandle.disabled = true;

    let client;
    switch (backend.value) {
        case "mastodon":
            client = new MastodonApiClient(selfUser.apiInstance, true);
            break;
        case "pleroma":
            client = new PleromaApiClient(selfUser.apiInstance, true);
            break;
        case "misskey":
            client = new MisskeyApiClient(selfUser.apiInstance);
            break;
        default:
            progress.innerText = "Detecting instance...";
            client = await ApiClient.getClient(selfUser.apiInstance);

            backend.value = (() => {
                switch (client.getClientName()) {
                    case "fedibird": return "mastodon";
                    default: return client.getClientName();
                }
            })();
            break;
    }

    progress.innerText = "Fetching your user...";

    const user = await client.getUserIdFromHandle(selfUser);

    if (!user) {
        alert("Something went horribly wrong, couldn't fetch your user.");
        fediHandle.disabled = false;
        for (const radio of backend) {
            radio.disabled = false;
        }
        generateBtn.style.display = "inline";
        progress.innerText = "";

        return;
    }

    progress.innerText = "Fetching your latest posts...";

    const notes = await client.getNotes(user);

    if (!notes) {
        alert("Something went horribly wrong, couldn't fetch your notes.");
        return;
    }

    /**
     * @type {Map<string, RatedUser>}
     */
    let connectionList = new Map();
    await processNotes(client, connectionList, notes);

    showConnections(user, connectionList);
}

/**
 * @param {ApiClient} client
 * @param {Map<string, RatedUser>} connectionList
 * @param {Note[]} notes
 */
async function processNotes(client, connectionList, notes) {
    let progress = document.getElementById("outInfo");
    let counter = 0;
    let total = notes.length;

    for (const note of notes) {
        progress.innerText = `Processing :3 (${counter}/${total}) `;
        await evaluateNote(client, connectionList, note);
        counter++;
    }
}

/**
@param {ApiClient} client
 * @param {Map<string, RatedUser>} connectionList
 * @param {Note} note
 */
async function evaluateNote(client, connectionList, note) {
    if (note.favorites > 0 || note.extra_reacts) {
        await client.getConsolidatedReactions(note, note.extra_reacts).then(users => {
            if (!users)
                return;

            users.forEach(user => {
                incConnectionValue(connectionList, user, 1.0);
            });
        }).catch(() => {});
    }

    if (note.renotes > 0) {
        await client.getRenotes(note).then(users => {
            if (!users)
                return;

            users.forEach(user => {
                incConnectionValue(connectionList, user, 1.3);
            });
        }).catch(() => {});
    }

    await client.getReplies(note).then(replies => {
        if (!replies)
            return [];

        replies.forEach(reply => {
            incConnectionValue(connectionList, reply.author, 1.1);
        });

        return replies;
    }).catch(() => {});
}

/**
 * @param {Map<string, RatedUser>} connectionList
 * @param {FediUser} user
 * @param {number} plus
 */
function incConnectionValue(connectionList, user, plus) {
    if (user.bot)
        return;

    if (!connectionList.has(user.id)) {
        connectionList.set(user.id, {
            conStrength: 0,
            ...user
        });
    }

    connectionList.get(user.id).conStrength += plus;
}

/**
 * @param {FediUser} localUser
 * @param {Map<string, RatedUser>} connectionList
 */
function showConnections(localUser, connectionList) {
    if (connectionList.has(localUser.id))
        connectionList.delete(localUser.id);

    // Sort dict into Array items
    const items = [...connectionList.values()].sort((first, second) => second.conStrength - first.conStrength);

    // Also export the Username List
    let usersDivs = [
        document.getElementById("ud1"),
        document.getElementById("ud2"),
        document.getElementById("ud3")
    ];

    usersDivs.forEach((div) => div.innerHTML = "")

    const [inner, middle, outer] = usersDivs;
    inner.innerHTML = "<div><h3>Inner Circle</h3></div>";
    middle.innerHTML = "<div><h3>Middle Circle</h3></div>";
    outer.innerHTML = "<div><h3>Outer Circle</h3></div>";

    for (let i= 0; i < items.length; i++) {
        const newUser = document.createElement("a");
        newUser.className = "userItem";
        newUser.innerText = items[i].handle.name;
        newUser.title = items[i].name;
        // I'm so sorry
        newUser.href = "javascript:void(0)";
        const handle = items[i].handle;
        newUser.onclick = async () => {
            const fingeredHandle = await handle.webFinger();
            if (fingeredHandle.profileUrl)
                window.open(fingeredHandle.profileUrl, "_blank");
            else
                alert("Could not fetch the profile URL for " + fingeredHandle.baseHandle);
        };

        const newUserHost = document.createElement("span");
        newUserHost.className = "userHost";
        newUserHost.innerText = "@" + items[i].handle.instance;
        newUser.appendChild(newUserHost);

        const newUserImg = document.createElement("img");
        newUserImg.src = items[i].avatar;
        newUserImg.alt = "";
        newUserImg.className = "userImg";
        newUserImg.onload = () => {
            newUserImg.title = newUserImg.alt = stripName(items[i].name || items[i].handle.name) + "'s avatar";
        };
        newUser.prepend(newUserImg);

        let udNum = 0;
        if (i > numb[0]) udNum = 1;
        if (i > numb[0] + numb[1]) udNum = 2;
        usersDivs[udNum].appendChild(newUser);
    }

    usersDivs.forEach((div) => {
        const items = div.querySelectorAll(".userItem");

        for (let i = 0; i < items.length - 1; i++) {
            const item = items[i];
            item.appendChild(document.createTextNode(", "));
        }
    });

    const outDiv = document.getElementById("outDiv");
    outDiv.style.display = "block";
    document.getElementById("outSelfUser").innerText = stripName(localUser.name || localUser.handle.name);

    render(items, localUser);
}

function stripName(name) {
    return name.replaceAll(/:[a-zA-Z0-9_]+:/g, "").trim();
}
