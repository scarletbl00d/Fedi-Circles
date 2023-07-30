/**
 *
 * @param {RequestInfo | URL} url
 * @param {{ body?: any } & RequestInit?} options
 */
async function apiRequest(url, options = null)
{
    console.log(`Fetching :: ${url}`);

    if (options && options.body) {
        options.body = JSON.stringify(options.body);
    }

    return await fetch(url, options ?? {})
        .then(response => response.json())
        .catch(error => {
            console.error(`Error fetching ${url}: ${error}`);
            return null;
        });
}

/**
 * @typedef {{
 *     name: string,
 *     instance: string,
 * }} Handle
 */

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
            const client = new MastodonApiClient(instance);
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
            const client = new MastodonApiClient(instance);
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

            const client = new MastodonApiClient(instance);
            instanceTypeCache.set(instance, client);
            return client;
        }

        let { software } = apiResponse;
        software.name = software.name.toLowerCase();

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

        const client = new MastodonApiClient(instance);
        instanceTypeCache.set(instance, client);
        return client;
    }

    /**
     * @param {Handle} handle
     *
     * @return {Promise<FediUser>}
     */
    async getUserIdFromHandle(handle){ throw new Error("Not implemented"); }

    /**
     * @param {FediUser} user
     *
     * return {Promise<Note[]>}
     */
    async getNotes(user){ throw new Error("Not implemented"); }

    /**
     * @param {Note} note
     *
     * return {Promise<FediUser[] | null>}
     */
    async getRenotes(note){ throw new Error("Not implemented"); }

    /**
     * @param {Note} note
     *
     * return {Promise<Note[] | null>}
     */
    async getReplies(note){ throw new Error("Not implemented"); }

    /**
     * @param {Note} note
     * @param {boolean} extra_reacts
     *
     * return {Promise<FediUser[] | null>}
     */
    async getFavs(note, extra_reacts) { throw new Error("Not implemented"); }

    /**
     * @return string
     */
    getClientName() { throw new Error("Not implemented"); }
}

class MastodonApiClient extends ApiClient {
    /**
     * @param {string} instance
     */
    constructor(instance) {
        super(instance);
    }

    async getUserIdFromHandle(handle) {
        const url = `https://${this._instance}/api/v1/accounts/lookup?acct=${handle.name}@${handle.instance}`;
        const response = await apiRequest(url, null);

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
        const url = `https://${this._instance}/api/v1/accounts/${user.id}/statuses?exclude_replies=true&exclude_reblogs=true&limit=40`;
        const response = await apiRequest(url, null);

        if (!response) {
            return null;
        }

        return response.map(note => ({
            id: note.id,
            replies: note["replies_count"] || 0,
            renotes: note["reblogs_count"] || 0,
            favorites: note["favourites_count"],
            // Actually a Pleroma/Akkoma thing
            extra_reacts: note?.["pleroma"]?.["emoji_reactions"]?.length > 0,
            instance: this._instance,
            author: user
        }));
    }

    async getRenotes(note) {
        const url = `https://${this._instance}/api/v1/statuses/${note.id}/reblogged_by`;
        const response = await apiRequest(url);

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
        const url = `https://${this._instance}/api/v1/statuses/${noteIn.id}/context`;
        const response = await apiRequest(url);

        if (!response) {
            return null;
        }

        return response["descendants"].map(note => {
            let handle = parseHandle(note["account"]["acct"], noteIn.instance);

            return {
                id: note.id,
                replies: note["replies_count"] || 0,
                renotes: note["reblogs_count"] || 0,
                favorites: note["favourites_count"],
                // Actually a Pleroma/Akkoma thing
                extra_reacts: note?.["pleroma"]?.["emoji_reactions"]?.length > 0,
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

    async getFavs(note, extra_reacts) {
        const url = `https://${this._instance}/api/v1/statuses/${note.id}/favourited_by`;
        const response = await apiRequest(url);

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
        super(instance);
        this._emoji_reacts = emoji_reacts;
    }

    async getFavs(note, extra_reacts) {
        // Pleroma/Akkoma supports both favs and emoji reacts
        // with several emoji reacts per users being possible.
        // Coalesce them and count every user only once
        let favs = await super.getFavs(note);

        if (!this._emoji_reacts || !extra_reacts)
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

        const url = `https://${this._instance}/api/v1/pleroma/statuses/${note.id}/reactions`;
        const response = await apiRequest(url) ?? [];

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
            if (user["host"] === handle.instance && user["username"] === handle.name) {
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
                limit: 70,
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
                limit: 50,
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
            handle: parseHandle(renote["user"]["username"], renote["user"]["host"])
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
                limit: 100,
            }
        });

        if (!response) {
            return null;
        }

        return response.map(reply => {
            const handle = parseHandle(reply["user"]["username"], reply["user"]["host"]);

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

    async getFavs(note, extra_reacts) {
        const url = `https://${this._instance}/api/notes/reactions`;
        const response = await apiRequest(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                noteId: note.id,
                limit: 100,
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
            handle: parseHandle(reaction["user"]["username"], reaction["user"]["host"])
        }));
    }

    getClientName() {
        return "misskey";
    }
}

/** @type Map<string, ApiClient> */
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

    return {
        name: name,
        instance: instance || fallbackInstance,
    };
}

/**
 * @typedef {FediUser & {conStrength: number}} RatedUser
 */

async function circleMain() {
    let progress = document.getElementById("outInfo");

    const generateBtn = document.getElementById("generateButton");

    generateBtn.style.display = "none";

    let fediHandle = document.getElementById("txt_mastodon_handle");
    const selfUser = parseHandle(fediHandle.value);

    let form = document.getElementById("generateForm");
    let backend = form.backend;
    for (const radio of backend) {
        radio.disabled = true;
    }

    fediHandle.disabled = true;

    let client;
    switch (backend.value) {
        case "mastodon":
            client = new MastodonApiClient(selfUser.instance);
            break;
        case "pleroma":
            client = new PleromaApiClient(selfUser.instance, true);
            break;
        case "misskey":
            client = new MisskeyApiClient(selfUser.instance);
            break;
        default:
            progress.innerText = "Detecting instance...";
            client = await ApiClient.getClient(selfUser.instance);
            backend.value = client.getClientName();
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

    progress.innerText = "Done :3";
}

/**
@param {ApiClient} client
 * @param {Map<string, RatedUser>} connectionList
 * @param {Note} note
 */
async function evaluateNote(client, connectionList, note) {
    if (note.favorites > 0 || note.extra_reacts) {
        await client.getFavs(note, note.extra_reacts).then(users => {
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

    console.log(items);

    // Also export the Username List
    let usersDivs = [
        document.getElementById("ud1"),
        document.getElementById("ud2"),
        document.getElementById("ud3")
    ];

    usersDivs.forEach((div) => div.innerHTML = "")
    
    for (let i=0; i < items.length; i++) {
        let newUser = document.createElement("p");
        newUser.innerText = "@" + items[i].handle.name + "@" + items[i].handle.instance;

        createUserObj(items[i]);

        let udNum = 0;
        if (i > numb[0]) udNum = 1;
        if (i > numb[0] + numb[1]) udNum = 2;
        usersDivs[udNum].appendChild(newUser);
    }

    render(items, localUser);
}

/**
 * @param {FediUser} usr
 */
function createUserObj(usr) {
    let usrElement = document.createElement("div");
    usrElement.innerHTML = `<img src="${usr.avatar}" width="20px">&nbsp;&nbsp;&nbsp;<b>${usr.name}</b>&nbsp;&nbsp;`;
    document.getElementById("outDiv").appendChild(usrElement);
}

