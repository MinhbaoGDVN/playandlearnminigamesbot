require("dotenv").config();
const dictionary = require("@vntk/dictionary");

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const { Pool } = require("pg");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DATABASE_URL = process.env.DATABASE_URL;

const http = require("http");

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Minigames Bot is running.");
}).listen(PORT);

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

const activeGames = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});


const games = [
    { name: "Đếm số", value: "demso" },
    { name: "Nối từ", value: "noitu" },
    { name: "Ma Sói", value: "masoi" }
];

const GAME_MASTERS = new Set([
    "1003155311084978266",
    "1504862059232366818",
    "1422193218006679745",
    "899100649663369248",
]);

function isGameMaster(userId) {
    return GAME_MASTERS.has(userId);
}

const commands = [
    new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Thiết lập game")
        .addStringOption(option =>
            option
                .setName("game")
                .setDescription("Game")
                .setRequired(true)
                .addChoices(...games)
        )
        .addChannelOption(option =>
            option
                .setName("in")
                .setDescription("Kênh chơi game")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)
        ),
    new SlashCommandBuilder()
        .setName("start")
        .setDescription("Bắt đầu game")
        .addStringOption(option =>
            option
                .setName("game")
                .setDescription("Game")
                .setRequired(true)
                .addChoices(...games)
        ),

    new SlashCommandBuilder()
        .setName("restart")
        .setDescription("Khởi động lại game")
        .addStringOption(option =>
            option
                .setName("game")
                .setDescription("Game")
                .setRequired(true)
                .addChoices(...games)
        ),
    new SlashCommandBuilder()
        .setName("stop")
        .setDescription("Dừng game")
        .addStringOption(option =>
            option
                .setName("game")
                .setDescription("Game")
                .setRequired(true)
                .addChoices(...games)
        )
];

async function initDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS game_configs (
            guild_id TEXT NOT NULL,
            game TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            PRIMARY KEY (guild_id, game)
        )
    `);

    console.log("Database ready.");
}

async function getGameConfig(guildId, game) {
    const result = await pool.query(
        `
        SELECT channel_id
        FROM game_configs
        WHERE guild_id = $1 AND game = $2
        `,
        [guildId, game]
    );

    return result.rows[0] || null;
}

async function startGame(game, guildId, channelId, gameMasterId) {
    const key = `${guildId}:${game}`;

    if (activeGames.has(key)) {
        return false;
    }

    const gameFunction = gameFunctions[game];

    if (!gameFunction) {
        return false;
    }

    const session = {
        game,
        guildId,
        channelId,
        gameMasterId,
        currentNumber: 0,
        lastUserId: null
    };

    activeGames.set(key, session);

    gameFunction(session).catch(error => {
        console.error(`Game ${game} crashed:`, error);
    
        if (session.messageHandler) {
            client.off("messageCreate", session.messageHandler);
        }
    
        activeGames.delete(key);
    });

    return true;
}

function stopGame(guildId, game) {
    const key = `${guildId}:${game}`;
    const session = activeGames.get(key);

    if (!session) {
        return false;
    }

    if (session.messageHandler) {
        client.off("messageCreate", session.messageHandler);
    }

    activeGames.delete(key);

    return true;
}

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        {
            body: commands.map(command => command.toJSON())
        }
    );

    console.log("Slash commands registered.");
}

client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);

    try {
        await initDatabase();
    } catch (error) {
        console.error("Database initialization failed:", error);
    }
});

const gameFunctions = {
    demso: startDemSo,
    noitu: startNoiTu,
    masoi: startMaSoi,
};

async function startDemSo(session) {
    const channel = await client.channels.fetch(session.channelId);

    if (!channel) {
        throw new Error("Không tìm thấy kênh Đếm số.");
    }

    session.currentNumber = 0;
    session.lastUserId = null;

    const messageHandler = async message => {
        if (message.channelId !== session.channelId) return;
        if (message.author.bot) return;
        if (!/^\d+$/.test(message.content.trim())) return;

        const number = Number(message.content.trim());

        if (message.author.id === session.lastUserId) {
            await message.react("❌").catch(() => {});

            await message.reply(
                "Bạn không được chơi 2 lượt liên tiếp!\nGame đã reset về **0**."
            ).catch(() => {});

            session.currentNumber = 0;
            session.lastUserId = null;

            return;
        }

        const expected = session.currentNumber + 1;

        if (number !== expected) {
            await message.react("❌").catch(() => {});

            await message.reply(
                `Sai! Số tiếp theo phải là **${expected}**.\n` +
                `Game đã reset về **0**.`
            ).catch(() => {});

            session.currentNumber = 0;
            session.lastUserId = null;

            return;
        }

        session.currentNumber = number;
        session.lastUserId = message.author.id;

        await message.react("✅").catch(() => {});
    };

    session.messageHandler = messageHandler;

    client.on("messageCreate", messageHandler);

    await channel.send(
        "**Đếm số bắt đầu!**\n" +
        "Số hiện tại: **0**\n" +
        "Hãy gửi **1**!"
    );
}

async function startNoiTu(session) {
    const channel = await client.channels.fetch(session.channelId);

    if (!channel) {
        throw new Error("Không tìm thấy kênh Nối từ.");
    }

    session.currentPhrase = null;
    session.usedWords = new Set();

    function normalizePhrase(text) {
        return text
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");
    }

    function getFirstWord(phrase) {
        return phrase.split(" ")[0];
    }

    function getLastWord(phrase) {
        const words = phrase.split(" ");
        return words[words.length - 1];
    }

    function checkVietnameseWord(phrase) {
        return dictionary.has(phrase);
    }

    const startingPhrases = [
        "học sinh",
        "sinh viên",
        "thời gian",
        "gia đình",
        "đất nước",
        "con người",
        "máy tính",
        "trường học",
        "công việc",
        "cuộc sống",
        "việt nam",
        "thành phố",
        "bạn bè",
        "mạng xã hội",
        "trò chơi",
        "âm nhạc",
        "bóng đá",
        "điện thoại",
        "công nghệ",
        "phần mềm"
    ];

    function chooseStartingPhrase() {
        const shuffled = [...startingPhrases]
            .sort(() => Math.random() - 0.5);

        for (const phrase of shuffled) {
            if (session.usedWords.has(phrase)) {
                continue;
            }

            if (checkVietnameseWord(phrase)) {
                return phrase;
            }
        }

        return null;
    }

    async function startRound() {
        session.currentPhrase = null;
        session.usedWords.clear();

        const startingPhrase = chooseStartingPhrase();

        if (!startingPhrase) {
            throw new Error(
                "Không tìm được cụm từ mở đầu hợp lệ."
            );
        }

        session.currentPhrase = startingPhrase;
        session.usedWords.add(startingPhrase);

        await channel.send(
            `Bắt đầu bằng từ: **${startingPhrase}**`
        );
    }

    async function resetRound(reason) {
        await channel.send(reason).catch(() => {});

        try {
            await startRound();
        } catch (error) {
            console.error(
                "Không thể bắt đầu lại Nối từ:",
                error
            );

            await channel.send(
                "Không thể bắt đầu lại Nối từ."
            ).catch(() => {});
        }
    }

    const messageHandler = async message => {
        if (message.channelId !== session.channelId) return;
        if (message.author.bot) return;

        const phrase = normalizePhrase(message.content);

        if (!phrase) return;
        if (phrase.length > 100) return;

        const words = phrase.split(" ");

        if (words.length < 2) return;

        if (session.usedWords.has(phrase)) {
            await message.react("❌").catch(() => {});

            await resetRound(
                "Cụm từ này đã được sử dụng.\n" +
                "Game đang bắt đầu lại."
            );

            return;
        }

        const requiredWord = getLastWord(
            session.currentPhrase
        );

        const firstWord = getFirstWord(phrase);

        if (firstWord !== requiredWord) {
            await message.react("❌").catch(() => {});

            await resetRound(
                `Sai rồi. Cụm từ phải bắt đầu bằng **${requiredWord}**.\n` +
                "Game đang bắt đầu lại."
            );

            return;
        }

        const valid = checkVietnameseWord(phrase);

        if (!valid) {
            await message.react("❌").catch(() => {});

            await resetRound(
                `Cụm từ **${phrase}** không hợp lệ hoặc không có trong từ điển.\n` +
                "Game đang bắt đầu lại."
            );

            return;
        }

        session.currentPhrase = phrase;
        session.usedWords.add(phrase);

        await message.react("✅").catch(() => {});
    };

    session.messageHandler = messageHandler;

    client.on("messageCreate", messageHandler);

    try {
        await startRound();
    } catch (error) {
        client.off("messageCreate", messageHandler);
        session.messageHandler = null;
        throw error;
    }
}

async function startMaSoi(session) {
    const channel = await client.channels.fetch(session.channelId);

    if (!channel) {
        throw new Error("Không tìm thấy kênh Ma Sói.");
    }

    session.phase = "lobby";

    session.players = new Map();
    session.roles = new Map();
    session.alivePlayers = new Set();

    session.night = 0;
    session.day = 0;

    session.nightActions = {
        wolfVotes: new Map(),
        guardian: null,
        seer: null,
        witchHeal: null,
        witchKill: null
    };

    session.voteResults = new Map();

    session.witchHealUsed = false;
    session.witchKillUsed = false;
    session.witchDone = false;
    session.witchPrompted = false;
    session.witchStage = null;

    session.nightLocked = false;
    session.nightResolving = false;

    session.pendingHunters = [];
    session.afterHunterPhase = null;

    const roleNames = {
        wolf: "Sói",
        villager: "Dân Làng",
        seer: "Tiên Tri",
        guardian: "Bảo Vệ",
        hunter: "Thợ Săn",
        witch: "Phù Thủy"
    };

    const getAlivePlayers = () => {
        return [...session.players.values()].filter(player =>
            session.alivePlayers.has(player.id)
        );
    };

    const getPlayer = id => {
        return session.players.get(id);
    };

    const getRole = id => {
        return session.roles.get(id);
    };

    const isAlive = id => {
        return session.alivePlayers.has(id);
    };

    const privateReply = async (interaction, content) => {
        const data = { content };

        if (interaction.inGuild()) {
            data.ephemeral = true;
        }

        return interaction.reply(data);
    };

    const sendDM = async (userId, content, components = []) => {
        try {
            const user = await client.users.fetch(userId);

            await user.send({
                content,
                components
            });

            return true;
        } catch (error) {
            console.error(
                `Không thể gửi DM cho ${userId}:`,
                error.message
            );

            return false;
        }
    };

    const createButtons = (prefix, players) => {
        if (players.length > 25) {
            throw new Error(
                "Không thể tạo quá 25 nút trong một lựa chọn."
            );
        }

        const rows = [];
        let row = [];

        for (const player of players) {
            row.push(
                new ButtonBuilder()
                    .setCustomId(
                        `masoi_${prefix}_${session.guildId}_${player.id}`
                    )
                    .setLabel(
                        player.username.slice(0, 80)
                    )
                    .setStyle(ButtonStyle.Primary)
            );

            if (row.length === 5) {
                rows.push(
                    new ActionRowBuilder().addComponents(row)
                );

                row = [];
            }
        }

        if (row.length > 0) {
            rows.push(
                new ActionRowBuilder().addComponents(row)
            );
        }

        return rows;
    };

    /*
     * =========================
     * LOBBY
     * =========================
     */

    const updateLobby = async () => {
        const players = [...session.players.values()];

        const list = players.length
            ? players
                .map(
                    (player, index) =>
                        `${index + 1}. <@${player.id}>`
                )
                .join("\n")
            : "Chưa có người chơi.";

        const embed = new EmbedBuilder()
            .setTitle("Ma Sói")
            .setDescription(
                `**Game Master:** <@${session.gameMasterId}>\n\n` +
                `Đã mở ván Ma Sói mới.\n\n` +
                `**Người chơi (${players.length}):**\n` +
                `${list}\n\n` +
                `Cần ít nhất **3 người** để bắt đầu.`
            );

        const buttons = [
            new ButtonBuilder()
                .setCustomId(
                    `masoi_join_${session.guildId}`
                )
                .setLabel("Tham gia")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId(
                    `masoi_leave_${session.guildId}`
                )
                .setLabel("Rời game")
                .setStyle(ButtonStyle.Secondary)
        ];

        if (players.length >= 3) {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(
                        `masoi_begin_${session.guildId}`
                    )
                    .setLabel("Bắt đầu")
                    .setStyle(ButtonStyle.Primary)
            );
        }

        const row = new ActionRowBuilder()
            .addComponents(buttons);

        if (session.lobbyMessage) {
            await session.lobbyMessage.edit({
                embeds: [embed],
                components: [row]
            }).catch(() => {});
        } else {
            session.lobbyMessage =
                await channel.send({
                    embeds: [embed],
                    components: [row]
                });
        }
    };

    /*
     * =========================
     * PHÂN ROLE
     * =========================
     */

    const assignRoles = () => {
        const players = [
            ...session.players.values()
        ];

        const shuffled = [...players]
            .sort(() => Math.random() - 0.5);

        let roles;

        if (players.length === 3) {
            roles = [
                "wolf",
                "seer",
                "villager"
            ];
        }

        else if (players.length === 4) {
            roles = [
                "wolf",
                "seer",
                "guardian",
                "villager"
            ];
        }

        else if (players.length === 5) {
            roles = [
                "wolf",
                "wolf",
                "seer",
                "guardian",
                "villager"
            ];
        }

        else if (players.length === 6) {
            roles = [
                "wolf",
                "wolf",
                "seer",
                "guardian",
                "witch",
                "villager"
            ];
        }

        else {
            const wolfCount = Math.max(
                2,
                Math.floor(players.length / 3)
            );

            roles = [
                ...Array(wolfCount).fill("wolf"),
                "seer",
                "guardian",
                "witch",
                "hunter"
            ];

            while (roles.length < players.length) {
                roles.push("villager");
            }

            roles = roles.slice(0, players.length);
        }

        shuffled.forEach((player, index) => {
            session.roles.set(
                player.id,
                roles[index]
            );

            session.alivePlayers.add(
                player.id
            );
        });
    };

    /*
     * =========================
     * GỬI ROLE
     * =========================
     */

    const sendRoleInfo = async () => {
        const wolves = getAlivePlayers()
            .filter(player =>
                getRole(player.id) === "wolf"
            );

        const failed = [];

        for (const player of session.players.values()) {
            const role = getRole(player.id);

            let text =
                `Bạn đang chơi **Ma Sói**.\n\n` +
                `Vai trò của bạn: **${roleNames[role]}**.`;

            if (role === "wolf") {
                const teammates = wolves
                    .filter(
                        wolf =>
                            wolf.id !== player.id
                    )
                    .map(
                        wolf =>
                            `<@${wolf.id}>`
                    );

                if (teammates.length) {
                    text +=
                        `\n\nĐồng đội Sói: ` +
                        teammates.join(", ");
                }
            }

            const success =
                await sendDM(
                    player.id,
                    text
                );

            if (!success) {
                failed.push(
                    `<@${player.id}>`
                );
            }
        }

        if (failed.length) {
            await channel.send(
                `Không thể gửi DM cho: ${failed.join(", ")}.\n` +
                `Họ có thể không bật nhận tin nhắn riêng.`
            );
        }
    };

    /*
     * =========================
     * CHECK WIN
     * =========================
     */

    const checkWin = async () => {
        const alive = getAlivePlayers();

        const wolves = alive.filter(
            player =>
                getRole(player.id) === "wolf"
        );

        const villagers = alive.filter(
            player =>
                getRole(player.id) !== "wolf"
        );

        if (wolves.length === 0) {
            session.phase = "ended";

            await channel.send(
                "**Dân Làng thắng!**\n" +
                "Tất cả Sói đã bị loại."
            );

            return true;
        }

        if (
            wolves.length >= villagers.length
        ) {
            session.phase = "ended";

            await channel.send(
                "**Sói thắng!**\n" +
                "Số Sói đã bằng hoặc vượt số người còn lại."
            );

            return true;
        }

        return false;
    };

    /*
     * =========================
     * GIẾT NGƯỜI
     * =========================
     */

    const killPlayer = async playerId => {
        if (!isAlive(playerId)) {
            return false;
        }

        session.alivePlayers.delete(
            playerId
        );

        await channel.send(
            `<@${playerId}> đã chết.`
        );

        return true;
    };

    /*
     * =========================
     * THỢ SĂN
     * =========================
     */

    const promptHunter = async () => {
        if (!session.pendingHunters.length) {
            return;
        }

        const hunterId =
            session.pendingHunters[0];

        const targets =
            getAlivePlayers().filter(
                player =>
                    player.id !== hunterId
            );

        if (!targets.length) {
            session.pendingHunters.shift();

            await continueAfterHunter();

            return;
        }

        await sendDM(
            hunterId,
            "Bạn là **Thợ Săn**.\n" +
            "Bạn đã chết và được bắn một người.",
            createButtons(
                "hunter",
                targets
            )
        );
    };

    const queueHunter = async (
        deadIds,
        nextPhase
    ) => {
        const hunters = deadIds.filter(
            id =>
                getRole(id) === "hunter"
        );

        if (!hunters.length) {
            return false;
        }

        session.pendingHunters =
            [...hunters];

        session.afterHunterPhase =
            nextPhase;

        session.phase = "hunter";

        await promptHunter();

        return true;
    };

    async function continueAfterHunter() {
        if (
            session.pendingHunters.length > 0
        ) {
            await promptHunter();
            return;
        }

        session.phase =
            session.afterHunterPhase;

        session.afterHunterPhase = null;

        if (await checkWin()) {
            return;
        }

        if (session.phase === "day") {
            await startDay();
        }

        else if (
            session.phase === "night"
        ) {
            await startNight();
        }
    }

    /*
     * =========================
     * PHÙ THỦY
     * =========================
     */

    const promptWitch = async () => {
        const witch =
            getAlivePlayers().find(
                player =>
                    getRole(player.id) === "witch"
            );

        if (!witch) {
            session.witchDone = true;
            return;
        }

        if (session.witchDone) {
            return;
        }

        const wolfTarget =
            getWolfTarget();

        if (!session.witchHealUsed &&
            !session.witchKillUsed) {

            const buttons = [];

            if (wolfTarget) {
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(
                            `masoi_witchheal_${session.guildId}_${wolfTarget}`
                        )
                        .setLabel("Cứu người")
                        .setStyle(ButtonStyle.Success)
                );
            }

            buttons.push(
                new ButtonBuilder()
                    .setCustomId(
                        `masoi_witchkillmenu_${session.guildId}`
                    )
                    .setLabel("Dùng thuốc độc")
                    .setStyle(ButtonStyle.Danger),

                new ButtonBuilder()
                    .setCustomId(
                        `masoi_witchskip_${session.guildId}`
                    )
                    .setLabel("Bỏ qua")
                    .setStyle(ButtonStyle.Secondary)
            );

            session.witchPrompted = true;
            session.witchStage = "menu";

            await sendDM(
                witch.id,
                wolfTarget
                    ? `Bạn là **Phù Thủy**.\n` +
                      `Sói đã chọn <@${wolfTarget}>.\n` +
                      `Bạn có thể cứu người này, dùng thuốc độc hoặc bỏ qua.`
                    : `Bạn là **Phù Thủy**.\n` +
                      `Hãy chọn hành động.`,
                [
                    new ActionRowBuilder()
                        .addComponents(buttons)
                ]
            );

            return;
        }

        if (
            !session.witchHealUsed &&
            session.witchKillUsed
        ) {
            const buttons = [
                new ButtonBuilder()
                    .setCustomId(
                        `masoi_witchheal_${session.guildId}_${wolfTarget}`
                    )
                    .setLabel("Cứu người")
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId(
                        `masoi_witchskip_${session.guildId}`
                    )
                    .setLabel("Bỏ qua")
                    .setStyle(ButtonStyle.Secondary)
            ];

            session.witchPrompted = true;
            session.witchStage = "menu";

            await sendDM(
                witch.id,
                `Bạn vẫn còn thuốc cứu.\n` +
                `Sói đã chọn <@${wolfTarget}>.`,
                [
                    new ActionRowBuilder()
                        .addComponents(buttons)
                ]
            );

            return;
        }

        if (
            session.witchHealUsed &&
            !session.witchKillUsed
        ) {
            const buttons = [
                new ButtonBuilder()
                    .setCustomId(
                        `masoi_witchkillmenu_${session.guildId}`
                    )
                    .setLabel("Dùng thuốc độc")
                    .setStyle(ButtonStyle.Danger),

                new ButtonBuilder()
                    .setCustomId(
                        `masoi_witchskip_${session.guildId}`
                    )
                    .setLabel("Bỏ qua")
                    .setStyle(ButtonStyle.Secondary)
            ];

            session.witchPrompted = true;
            session.witchStage = "menu";

            await sendDM(
                witch.id,
                "Bạn vẫn còn thuốc độc.",
                [
                    new ActionRowBuilder()
                        .addComponents(buttons)
                ]
            );

            return;
        }

        session.witchDone = true;
    };

    /*
     * =========================
     * XÁC ĐỊNH MỤC TIÊU SÓI
     * =========================
     */

    function getWolfTarget() {
        const votes =
            session.nightActions.wolfVotes;

        if (!votes.size) {
            return null;
        }

        const counts = new Map();

        for (const targetId of votes.values()) {
            counts.set(
                targetId,
                (counts.get(targetId) || 0) + 1
            );
        }

        const max =
            Math.max(...counts.values());

        const winners =
            [...counts.entries()]
                .filter(
                    ([, count]) =>
                        count === max
                )
                .map(([id]) => id);

        return winners[
            Math.floor(
                Math.random() *
                winners.length
            )
        ];
    }

    /*
     * =========================
     * RESOLVE ĐÊM
     * =========================
     */

    const resolveNight = async () => {
        const wolfTarget =
            getWolfTarget();

        const protectedTarget =
            session.nightActions.guardian;

        const witchHeal =
            session.nightActions.witchHeal;

        const witchKill =
            session.nightActions.witchKill;

        const deaths = [];

        if (
            wolfTarget &&
            wolfTarget !== protectedTarget &&
            wolfTarget !== witchHeal
        ) {
            deaths.push(wolfTarget);
        }

        if (
            witchKill &&
            isAlive(witchKill)
        ) {
            deaths.push(witchKill);
        }

        const uniqueDeaths =
            [...new Set(deaths)];

        for (const playerId of uniqueDeaths) {
            await killPlayer(playerId);
        }

        if (uniqueDeaths.length) {
            await channel.send(
                `**Buổi sáng.**\n` +
                uniqueDeaths
                    .map(id => `<@${id}>`)
                    .join(", ") +
                ` đã chết trong đêm.`
            );
        } else {
            await channel.send(
                "**Buổi sáng.**\n" +
                "Không có ai chết trong đêm."
            );
        }

        session.nightActions = {
            wolfVotes: new Map(),
            guardian: null,
            seer: null,
            witchHeal: null,
            witchKill: null
        };

        session.witchPrompted = false;
        session.witchStage = null;
        session.witchDone = false;
        session.nightLocked = false;

        if (
            await queueHunter(
                uniqueDeaths,
                "day"
            )
        ) {
            return;
        }

        if (await checkWin()) {
            return;
        }

        await startDay();
    };

    /*
     * =========================
     * KIỂM TRA ĐỦ ACTION ĐÊM
     * =========================
     */

    const tryResolveNight = async () => {
        if (
            session.phase !== "night" ||
            session.nightResolving
        ) {
            return;
        }

        const wolves =
            getAlivePlayers().filter(
                player =>
                    getRole(player.id) === "wolf"
            );

        for (const wolf of wolves) {
            if (
                !session.nightActions.wolfVotes
                    .has(wolf.id)
            ) {
                return;
            }
        }

        const guardian =
            getAlivePlayers().find(
                player =>
                    getRole(player.id) === "guardian"
            );

        if (
            guardian &&
            !session.nightActions.guardian
        ) {
            return;
        }

        const witch =
            getAlivePlayers().find(
                player =>
                    getRole(player.id) === "witch"
            );

        if (
            witch &&
            !session.witchDone
        ) {
            await promptWitch();
            return;
        }

        session.nightResolving = true;

        await resolveNight();

        session.nightResolving = false;
    };

    /*
     * =========================
     * BẮT ĐẦU ĐÊM
     * =========================
     */

    async function startNight() {
        if (session.phase === "ended") {
            return;
        }

        session.phase = "night";
        session.night++;

        session.nightActions = {
            wolfVotes: new Map(),
            guardian: null,
            seer: null,
            witchHeal: null,
            witchKill: null
        };

        session.witchDone = false;
        session.witchPrompted = false;
        session.witchStage = null;
        session.nightLocked = false;
        session.nightResolving = false;

        await channel.send(
            `**Buổi đêm ${session.night} bắt đầu.**\n` +
            `Các vai trò có kỹ năng hãy thực hiện hành động.`
        );

        const alive =
            getAlivePlayers();

        const wolves =
            alive.filter(
                player =>
                    getRole(player.id) === "wolf"
            );

        const wolfTargets =
            alive.filter(
                player =>
                    getRole(player.id) !== "wolf"
            );

        for (const wolf of wolves) {
            await sendDM(
                wolf.id,
                "Bạn là **Sói**.\n" +
                "Chọn một người để giết đêm nay.",
                createButtons(
                    "wolf",
                    wolfTargets
                )
            );
        }

        const seer =
            alive.find(
                player =>
                    getRole(player.id) === "seer"
            );

        if (seer) {
            const targets =
                alive.filter(
                    player =>
                        player.id !== seer.id
                );

            await sendDM(
                seer.id,
                "Bạn là **Tiên Tri**.\n" +
                "Chọn một người để soi.",
                createButtons(
                    "seer",
                    targets
                )
            );
        }

        const guardian =
            alive.find(
                player =>
                    getRole(player.id) === "guardian"
            );

        if (guardian) {
            await sendDM(
                guardian.id,
                "Bạn là **Bảo Vệ**.\n" +
                "Chọn một người để bảo vệ.",
                createButtons(
                    "guardian",
                    alive
                )
            );
        }

        await tryResolveNight();
    }

    /*
     * =========================
     * BAN NGÀY
     * =========================
     */

    async function startDay() {
        if (session.phase === "ended") {
            return;
        }

        session.phase = "day";
        session.day++;
        session.voteResults.clear();

        const alive =
            getAlivePlayers();

        await channel.send(
            `**Ngày ${session.day} bắt đầu.**\n` +
            "Mọi người có thể thảo luận và bỏ phiếu."
        );

        const buttons =
            createButtons(
                "vote",
                alive
            );

        for (const player of alive) {
            await sendDM(
                player.id,
                "Đã đến lúc bỏ phiếu.\n" +
                "Chọn một người để treo cổ.",
                buttons
            );
        }
    }

    /*
     * =========================
     * RESOLVE VOTE
     * =========================
     */

    const resolveVotes = async () => {
        const counts = new Map();

        for (
            const targetId
            of session.voteResults.values()
        ) {
            counts.set(
                targetId,
                (counts.get(targetId) || 0) + 1
            );
        }

        if (!counts.size) {
            await channel.send(
                "Không có phiếu bầu hợp lệ."
            );

            await startNight();
            return;
        }

        const maxVotes =
            Math.max(...counts.values());

        const winners =
            [...counts.entries()]
                .filter(
                    ([, count]) =>
                        count === maxVotes
                )
                .map(([id]) => id);

        if (winners.length !== 1) {
            await channel.send(
                "Kết quả hòa. Không ai bị treo cổ."
            );

            session.voteResults.clear();

            await startNight();

            return;
        }

        const eliminated =
            winners[0];

        await killPlayer(
            eliminated
        );

        const role =
            getRole(eliminated);

        await channel.send(
            `<@${eliminated}> bị treo cổ.\n` +
            `Vai trò: **${roleNames[role]}**.`
        );

        session.voteResults.clear();

        if (
            await queueHunter(
                [eliminated],
                "night"
            )
        ) {
            return;
        }

        if (await checkWin()) {
            return;
        }

        await startNight();
    };

    /*
     * =========================
     * BUTTON HANDLER
     * =========================
     */

    const buttonHandler = async interaction => {
        if (!interaction.isButton()) {
            return;
        }

        const parts =
            interaction.customId.split("_");

        if (parts[0] !== "masoi") {
            return;
        }

        const action = parts[1];
        const guildId = parts[2];
        const targetId = parts[3];

        if (
            guildId !== session.guildId
        ) {
            return;
        }

        /*
         * Quan trọng:
         * Button ban đêm nằm trong DM.
         * interaction.guildId lúc này = null.
         * Vì vậy KHÔNG được bắt buộc
         * interaction.guildId === session.guildId.
         */

        /*
         * =========================
         * LOBBY
         * =========================
         */

        if (
            action === "join" ||
            action === "leave" ||
            action === "begin"
        ) {
            if (
                interaction.guildId !==
                session.guildId
            ) {
                return privateReply(
                    interaction,
                    "Nút này chỉ dùng trong server."
                );
            }

            if (
                session.phase !== "lobby"
            ) {
                return privateReply(
                    interaction,
                    "Lobby đã đóng."
                );
            }

            if (action === "join") {
                if (
                    session.players.has(
                        interaction.user.id
                    )
                ) {
                    return privateReply(
                        interaction,
                        "Bạn đã tham gia."
                    );
                }

                if (
                    session.players.size >= 25
                ) {
                    return privateReply(
                        interaction,
                        "Game đã đủ số người tối đa."
                    );
                }

                session.players.set(
                    interaction.user.id,
                    {
                        id: interaction.user.id,
                        username:
                            interaction.user.username
                    }
                );

                await privateReply(
                    interaction,
                    "Bạn đã tham gia Ma Sói."
                );

                await updateLobby();

                return;
            }

            if (action === "leave") {
                if (
                    !session.players.has(
                        interaction.user.id
                    )
                ) {
                    return privateReply(
                        interaction,
                        "Bạn chưa tham gia."
                    );
                }

                session.players.delete(
                    interaction.user.id
                );

                await privateReply(
                    interaction,
                    "Bạn đã rời Ma Sói."
                );

                await updateLobby();

                return;
            }

            if (action === "begin") {
                if (
                    interaction.user.id !==
                    session.gameMasterId
                ) {
                    return privateReply(
                        interaction,
                        "Chỉ Game Master mới có thể bắt đầu."
                    );
                }

                if (
                    session.players.size < 3
                ) {
                    return privateReply(
                        interaction,
                        "Cần ít nhất 3 người chơi."
                    );
                }

                await interaction.deferUpdate();

                session.phase =
                    "starting";

                await interaction.message.edit({
                    components: []
                }).catch(() => {});

                assignRoles();

                await channel.send(
                    `**Ván Ma Sói bắt đầu!**\n` +
                    `Có **${session.players.size} người chơi**.`
                );

                await sendRoleInfo();

                await startNight();

                return;
            }
        }

        /*
         * =========================
         * THỢ SĂN
         * =========================
         */

        if (action === "hunter") {
            if (
                session.phase !== "hunter"
            ) {
                return privateReply(
                    interaction,
                    "Hành động Thợ Săn không còn hợp lệ."
                );
            }

            const hunterId =
                session.pendingHunters[0];

            if (
                interaction.user.id !==
                hunterId
            ) {
                return privateReply(
                    interaction,
                    "Chưa đến lượt Thợ Săn của bạn."
                );
            }

            if (
                !targetId ||
                !isAlive(targetId)
            ) {
                return privateReply(
                    interaction,
                    "Người này đã chết hoặc không hợp lệ."
                );
            }

            await interaction.deferUpdate();

            await killPlayer(
                targetId
            );

            await channel.send(
                `<@${hunterId}> đã sử dụng quyền Thợ Săn ` +
                `và bắn <@${targetId}>.`
            );

            session.pendingHunters.shift();

            if (
                getRole(targetId) === "hunter"
            ) {
                session.pendingHunters.push(
                    targetId
                );
            }

            if (await checkWin()) {
                return;
            }

            await continueAfterHunter();

            return;
        }

        /*
         * =========================
         * ĐÊM
         * =========================
         */

        if (
            session.phase === "night"
        ) {
            if (
                action === "wolf"
            ) {
                if (
                    session.nightLocked
                ) {
                    return privateReply(
                        interaction,
                        "Đêm đã được khóa."
                    );
                }

                if (
                    !isAlive(
                        interaction.user.id
                    )
                ) {
                    return privateReply(
                        interaction,
                        "Bạn đã chết."
                    );
                }

                if (
                    getRole(
                        interaction.user.id
                    ) !== "wolf"
                ) {
                    return privateReply(
                        interaction,
                        "Bạn không phải Sói."
                    );
                }

                if (
                    !targetId ||
                    !isAlive(targetId)
                ) {
                    return privateReply(
                        interaction,
                        "Mục tiêu không hợp lệ."
                    );
                }

                if (
                    getRole(targetId) === "wolf"
                ) {
                    return privateReply(
                        interaction,
                        "Sói không thể chọn Sói."
                    );
                }

                session.nightActions
                    .wolfVotes
                    .set(
                        interaction.user.id,
                        targetId
                    );

                await privateReply(
                    interaction,
                    `Đã chọn <@${targetId}>.`
                );

                const wolves =
                    getAlivePlayers()
                        .filter(
                            player =>
                                getRole(
                                    player.id
                                ) === "wolf"
                        );

                const allChosen =
                    wolves.every(
                        wolf =>
                            session.nightActions
                                .wolfVotes
                                .has(wolf.id)
                    );

                if (allChosen) {
                    session.nightLocked = true;

                    await promptWitch();

                    await tryResolveNight();
                }

                return;
            }

            if (
                action === "seer"
            ) {
                if (
                    !isAlive(
                        interaction.user.id
                    )
                ) {
                    return privateReply(
                        interaction,
                        "Bạn đã chết."
                    );
                }

                if (
                    getRole(
                        interaction.user.id
                    ) !== "seer"
                ) {
                    return privateReply(
                        interaction,
                        "Bạn không phải Tiên Tri."
                    );
                }

                if (
                    !targetId ||
                    !isAlive(targetId)
                ) {
                    return privateReply(
                        interaction,
                        "Mục tiêu không hợp lệ."
                    );
                }

                const targetRole =
                    getRole(targetId);

                session.nightActions.seer =
                    targetId;

                return privateReply(
                    interaction,
                    `<@${targetId}> là **${roleNames[targetRole]}**.`
                );
            }

            if (
                action === "guardian"
            ) {
                if (
                    !isAlive(
                        interaction.user.id
                    )
                ) {
                    return privateReply(
                        interaction,
                        "Bạn đã chết."
                    );
                }

                if (
                    getRole(
                        interaction.user.id
                    ) !== "guardian"
                ) {
                    return privateReply(
                        interaction,
                        "Bạn không phải Bảo Vệ."
                    );
                }

                if (
                    !targetId ||
                    !isAlive(targetId)
                ) {
                    return privateReply(
                        interaction,
                        "Mục tiêu không hợp lệ."
                    );
                }

                session.nightActions.guardian =
                    targetId;

                await privateReply(
                    interaction,
                    `Bạn đã bảo vệ <@${targetId}>.`
                );

                await tryResolveNight();

                return;
            }

            /*
             * =========================
             * PHÙ THỦY
             * =========================
             */

            if (
                action === "witchheal"
            ) {
                if (
                    getRole(
                        interaction.user.id
                    ) !== "witch"
                ) {
                    return privateReply(
                        interaction,
                        "Bạn không phải Phù Thủy."
                    );
                }

                if (
                    session.witchHealUsed
                ) {
                    return privateReply(
                        interaction,
                        "Bạn đã dùng thuốc cứu."
                    );
                }

                const wolfTarget =
                    getWolfTarget();

                if (
                    !wolfTarget ||
                    targetId !== wolfTarget
                ) {
                    return privateReply(
                        interaction,
                        "Mục tiêu cứu không còn hợp lệ."
                    );
                }

                session.witchHealUsed = true;

                session.nightActions.witchHeal =
                    targetId;

                session.witchStage = null;
                session.witchPrompted = false;

                await privateReply(
                    interaction,
                    `Bạn đã cứu <@${targetId}>.`
                );

                await promptWitch();

                await tryResolveNight();

                return;
            }

            if (
                action === "witchkillmenu"
            ) {
                if (
                    getRole(
                        interaction.user.id
                    ) !== "witch"
                ) {
                    return privateReply(
                        interaction,
                        "Bạn không phải Phù Thủy."
                    );
                }

                if (
                    session.witchKillUsed
                ) {
                    return privateReply(
                        interaction,
                        "Bạn đã dùng thuốc độc."
                    );
                }

                const targets =
                    getAlivePlayers().filter(
                        player =>
                            player.id !==
                            interaction.user.id
                    );

                session.witchStage =
                    "kill";

                await privateReply(
                    interaction,
                    "Hãy chọn người muốn dùng thuốc độc."
                );

                await sendDM(
                    interaction.user.id,
                    "Chọn người bị thuốc độc.",
                    createButtons(
                        "witchkill",
                        targets
                    )
                );

                return;
            }

            if (
                action === "witchkill"
            ) {
                if (
                    getRole(
                        interaction.user.id
                    ) !== "witch"
                ) {
                    return privateReply(
                        interaction,
                        "Bạn không phải Phù Thủy."
                    );
                }

                if (
                    session.witchStage !==
                    "kill"
                ) {
                    return privateReply(
                        interaction,
                        "Hành động này không còn hợp lệ."
                    );
                }

                if (
                    session.witchKillUsed
                ) {
                    return privateReply(
                        interaction,
                        "Bạn đã dùng thuốc độc."
                    );
                }

                if (
                    !targetId ||
                    !isAlive(targetId)
                ) {
                    return privateReply(
                        interaction,
                        "Mục tiêu không hợp lệ."
                    );
                }

                session.witchKillUsed = true;

                session.nightActions.witchKill =
                    targetId;

                session.witchStage = null;
                session.witchPrompted = false;

                await privateReply(
                    interaction,
                    `Bạn đã chọn đầu độc <@${targetId}>.`
                );

                await promptWitch();

                await tryResolveNight();

                return;
            }

            if (
                action === "witchskip"
            ) {
                if (
                    getRole(
                        interaction.user.id
                    ) !== "witch"
                ) {
                    return privateReply(
                        interaction,
                        "Bạn không phải Phù Thủy."
                    );
                }

                session.witchDone = true;
                session.witchStage = null;
                session.witchPrompted = false;

                await privateReply(
                    interaction,
                    "Bạn đã bỏ qua lượt Phù Thủy."
                );

                await tryResolveNight();

                return;
            }
        }

        /*
         * =========================
         * BAN NGÀY
         * =========================
         */

        if (
            session.phase === "day" &&
            action === "vote"
        ) {
            if (
                !isAlive(
                    interaction.user.id
                )
            ) {
                return privateReply(
                    interaction,
                    "Bạn đã chết."
                );
            }

            if (
                !targetId ||
                !isAlive(targetId)
            ) {
                return privateReply(
                    interaction,
                    "Người này đã chết."
                );
            }

            session.voteResults.set(
                interaction.user.id,
                targetId
            );

            await privateReply(
                interaction,
                `Bạn đã vote <@${targetId}>.`
            );

            const alive =
                getAlivePlayers();

            if (
                alive.every(
                    player =>
                        session.voteResults
                            .has(player.id)
                )
            ) {
                await resolveVotes();
            }

            return;
        }
    };

    session.buttonHandler =
        buttonHandler;

    client.on(
        "interactionCreate",
        buttonHandler
    );

    try {
        await updateLobby();
    } catch (error) {
        client.off(
            "interactionCreate",
            buttonHandler
        );

        session.buttonHandler = null;

        throw error;
    }
}


client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "setup") {
        if (!isGameMaster(interaction.user.id)) {
            return interaction.reply({
                content: "Bạn không có quyền sử dụng lệnh này.",
                ephemeral: true
            });
        }
        const game = interaction.options.getString("game");
        const channel = interaction.options.getChannel("in");

        try {
            await pool.query(
                `
                INSERT INTO game_configs (guild_id, game, channel_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (guild_id, game)
                DO UPDATE SET channel_id = EXCLUDED.channel_id
                `,
                [interaction.guildId, game, channel.id]
            );

        await interaction.reply({
            content: `Đã thiết lập ${game} tại ${channel}.`,
            ephemeral: true
        });
            
        } catch (error) {
            console.error(error);

            await interaction.reply({
                content: "Không thể lưu thiết lập.",
                ephemeral: true
            });
        }

        return;
    }

    if (interaction.commandName === "start") {
        if (!isGameMaster(interaction.user.id)) {
            return interaction.reply({
                content: "Bạn không có quyền sử dụng lệnh này.",
                ephemeral: true
            });
        }
    
        const game = interaction.options.getString("game");
    
        const config = await getGameConfig(
            interaction.guildId,
            game
        );
    
        if (!config) {
            return interaction.reply({
                content: "Game này chưa được setup.",
                ephemeral: true
            });
        }
    
        const key = `${interaction.guildId}:${game}`;
    
        if (activeGames.has(key)) {
            return interaction.reply({
                content: "Game này đang chạy rồi.",
                ephemeral: true
            });
        }
    
        const started = await startGame(
            game,
            interaction.guildId,
            config.channel_id,
            interaction.user.id
        );
    
        if (!started) {
            return interaction.reply({
                content: "Không thể bắt đầu game.",
                ephemeral: true
            });
        }
    
        const gameNames = {
            demso: "Đếm số",
            noitu: "Nối từ",
            masoi: "Ma Sói"
        };
    
        return interaction.reply({
            content: `Đã bật **${gameNames[game] || game}** tại <#${config.channel_id}>.`,
            ephemeral: true
        });
    }

    if (interaction.commandName === "restart") {
        if (!isGameMaster(interaction.user.id)) {
            return interaction.reply({
                content: "Bạn không có quyền sử dụng lệnh này.",
                ephemeral: true
            });
        }
    
        const game = interaction.options.getString("game");
        const config = await getGameConfig(
            interaction.guildId,
            game
        );
    
        if (!config) {
            return interaction.reply({
                content: "Game này chưa được setup.",
                ephemeral: true
            });
        }
    
        stopGame(interaction.guildId, game);
    
        const started = await startGame(
            game,
            interaction.guildId,
            config.channel_id,
            interaction.user.id
        );
    
        if (!started) {
            return interaction.reply({
                content: "Không thể khởi động lại game.",
                ephemeral: true
            });
        }
    
        return interaction.reply({
            content: `Đã khởi động lại **${game}**.`,
            ephemeral: true
        });
    }
    
    if (interaction.commandName === "stop") {
        if (!isGameMaster(interaction.user.id)) {
            return interaction.reply({
                content: "Bạn không có quyền sử dụng lệnh này.",
                ephemeral: true
            });
        }
    
        const game = interaction.options.getString("game");
    
        const stopped = stopGame(
            interaction.guildId,
            game
        );
    
        if (!stopped) {
            return interaction.reply({
                content: "Game này hiện không chạy.",
                ephemeral: true
            });
        }
    
        const gameNames = {
            demso: "Đếm số",
            noitu: "Nối từ",
            masoi: "Ma Sói"
        };
    
        return interaction.reply({
            content: `Đã dừng **${gameNames[game] || game}**.`,
            ephemeral: true
        });
    }
});

async function startBot() {
    try {
        await registerCommands();
        await client.login(TOKEN);
    } catch (error) {
        console.error("Failed to start bot:", error);
        process.exit(1);
    }
}

startBot();
