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

    // =========================
    // SESSION
    // =========================

    session.phase = "lobby";

    session.players = new Map();
    session.roles = new Map();
    session.alivePlayers = new Set();

    session.night = 0;
    session.day = 0;

    session.nightStep = null;

    session.nightActions = new Map();
    session.votes = new Map();

    session.witchHealUsed = false;
    session.witchKillUsed = false;

    session.mayorId = null;

    session.lobbyMessage = null;

    // =========================
    // ROLE NAMES
    // =========================

    const roleNames = {
        wolf: "Sói",
        villager: "Dân Làng",
        seer: "Tiên Tri",
        guardian: "Bảo Vệ",
        hunter: "Thợ Săn",
        witch: "Phù Thủy"
    };

    // =========================
    // BASIC HELPERS
    // =========================

    const getPlayer = id => {
        return session.players.get(id);
    };

    const getRole = id => {
        return session.roles.get(id);
    };

    const isAlive = id => {
        return session.alivePlayers.has(id);
    };

    const getAlivePlayers = () => {
        return [...session.players.values()]
            .filter(player => session.alivePlayers.has(player.id));
    };

    const getAliveByRole = role => {
        return getAlivePlayers().filter(
            player => getRole(player.id) === role
        );
    };

    // =========================
    // DM
    // =========================

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

    // =========================
    // BUTTON CREATOR
    // =========================

    const createTargetButtons = (action, players) => {
        const rows = [];
        let row = [];

        for (const player of players) {
            const button = new ButtonBuilder()
                .setCustomId(
                    `masoi_${action}_${session.guildId}_${player.id}`
                )
                .setLabel(
                    player.username.slice(0, 80)
                )
                .setStyle(ButtonStyle.Primary);

            row.push(button);

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

    // =========================
    // LOBBY
    // =========================

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
            .setTitle("🐺 Ma Sói")
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

        const row =
            new ActionRowBuilder().addComponents(buttons);

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

    // =========================
    // ASSIGN ROLES
    // =========================

    const assignRoles = () => {
        const players = [...session.players.values()];

        const shuffled = [...players]
            .sort(() => Math.random() - 0.5);

        let roles = [];

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

        // Chọn trưởng làng ngẫu nhiên ban đầu
        const alive = [...session.players.values()];

        if (alive.length > 0) {
            const mayor =
                alive[
                    Math.floor(
                        Math.random() * alive.length
                    )
                ];

            session.mayorId = mayor.id;
        }
    };

    // =========================
    // ROLE DM
    // =========================

    const sendRoleInfo = async () => {
        const wolves =
            getAliveByRole("wolf");

        for (const player of session.players.values()) {
            const role =
                getRole(player.id);

            let text =
                `Bạn đang chơi **Ma Sói**.\n\n` +
                `Vai trò của bạn: **${roleNames[role]}**.`;

            if (player.id === session.mayorId) {
                text +=
                    `\n\n👑 Bạn hiện là **Trưởng Làng**. ` +
                    `Phiếu của bạn có giá trị **2**.`;
            }

            if (role === "wolf") {
                const teammates =
                    wolves
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

            await sendDM(
                player.id,
                text
            );
        }
    };

    // =========================
    // WIN CHECK
    // =========================

    const checkWin = async () => {
        const alive =
            getAlivePlayers();

        const wolves =
            alive.filter(
                player =>
                    getRole(player.id) === "wolf"
            );

        const villagers =
            alive.filter(
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

        if (wolves.length >= villagers.length) {
            session.phase = "ended";

            await channel.send(
                "**Sói thắng!**\n" +
                "Số Sói đã bằng hoặc vượt số người không phải Sói."
            );

            return true;
        }

        return false;
    };

    // =========================
    // KILL PLAYER
    // =========================

    const killPlayer = async playerId => {
        if (!isAlive(playerId)) {
            return false;
        }

        session.alivePlayers.delete(
            playerId
        );

        return true;
    };

    // =========================
    // START HUNTER ACTION
    // =========================

    const startHunterAction = async hunterId => {
        if (!session.players.has(hunterId)) {
            return;
        }

        const targets =
            getAlivePlayers()
                .filter(
                    player =>
                        player.id !== hunterId
                );

        if (!targets.length) {
            return;
        }

        session.phase =
            "hunter";

        await channel.send(
            `🔫 <@${hunterId}> là **Thợ Săn**.\n` +
            `Thợ Săn có quyền chọn một người để bắn.`
        );

        await sendDM(
            hunterId,
            "Bạn là **Thợ Săn**.\n" +
            "Bạn đã chết. Hãy chọn một người để bắn.",
            createTargetButtons(
                "hunter",
                targets
            )
        );
    };

    // =========================
    // NIGHT FINISH
    // =========================

    const finishNight = async () => {
        if (session.phase === "ended") {
            return;
        }

        session.phase = "resolving_night";

        const wolfTarget =
            session.nightActions.get("wolf");

        const guardianTarget =
            session.nightActions.get("guardian");

        const witchHealTarget =
            session.nightActions.get("witch_heal");

        const witchKillTarget =
            session.nightActions.get("witch_kill");

        const deaths = new Set();

        // Sói giết
        if (
            wolfTarget &&
            wolfTarget !== guardianTarget &&
            wolfTarget !== witchHealTarget &&
            isAlive(wolfTarget)
        ) {
            deaths.add(wolfTarget);
        }

        // Phù thủy độc
        if (
            witchKillTarget &&
            isAlive(witchKillTarget)
        ) {
            deaths.add(
                witchKillTarget
            );
        }

        // Xóa action trước khi xử lý
        session.nightActions.clear();

        // Giết người
        for (const playerId of deaths) {
            await killPlayer(playerId);
        }

        // =========================
        // BUỔI SÁNG
        // =========================

        session.phase = "morning";

        await channel.send(
            `☀️ **BUỔI SÁNG ${session.night}**`
        );

        if (deaths.size === 0) {
            await channel.send(
                "Đêm qua **không có ai chết**."
            );
        } else {
            for (const playerId of deaths) {
                const role =
                    getRole(playerId);

                await channel.send(
                    `<@${playerId}> đã chết.\n` +
                    `Vai trò: **${roleNames[role]}**.`
                );
            }
        }

        // Kiểm tra thắng
        if (await checkWin()) {
            return;
        }

        // Nếu có Thợ Săn chết
        for (const playerId of deaths) {
            if (
                getRole(playerId) === "hunter"
            ) {
                await startHunterAction(
                    playerId
                );

                return;
            }
        }

        await startDay();
    };

    // =========================
    // START SEER
    // =========================

    const startSeer = async () => {
        const seer =
            getAliveByRole("seer")[0];

        if (!seer) {
            await finishNight();
            return;
        }

        session.nightStep = "seer";

        const targets =
            getAlivePlayers()
                .filter(
                    player =>
                        player.id !== seer.id
                );

        if (!targets.length) {
            await finishNight();
            return;
        }

        await channel.send(
            "🔮 **Tiên Tri đang hành động...**"
        );

        await sendDM(
            seer.id,
            "Bạn là **Tiên Tri**.\n" +
            "Chọn một người để soi.",
            createTargetButtons(
                "seer",
                targets
            )
        );
    };

    // =========================
    // START WITCH
    // =========================

    const startWitch = async () => {
        const witch =
            getAliveByRole("witch")[0];

        if (!witch) {
            await startSeer();
            return;
        }

        session.nightStep = "witch";

        const wolfTarget =
            session.nightActions.get(
                "wolf"
            );

        let content =
            "🧙 Bạn là **Phù Thủy**.\n\n";

        if (wolfTarget) {
            content +=
                `Sói đã chọn <@${wolfTarget}>.\n\n`;
        } else {
            content +=
                "Sói chưa có mục tiêu.\n\n";
        }

        const buttons = [];

        if (
            wolfTarget &&
            !session.witchHealUsed
        ) {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(
                        `masoi_witchheal_${session.guildId}`
                    )
                    .setLabel("Cứu người")
                    .setStyle(
                        ButtonStyle.Success
                    )
            );
        }

        if (!session.witchKillUsed) {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(
                        `masoi_witchkill_${session.guildId}`
                    )
                    .setLabel("Dùng thuốc độc")
                    .setStyle(
                        ButtonStyle.Danger
                    )
            );
        }

        buttons.push(
            new ButtonBuilder()
                .setCustomId(
                    `masoi_witchskip_${session.guildId}`
                )
                .setLabel("Bỏ qua")
                .setStyle(
                    ButtonStyle.Secondary
                )
        );

        await channel.send(
            "🧙 **Phù Thủy đang hành động...**"
        );

        await sendDM(
            witch.id,
            content,
            [
                new ActionRowBuilder()
                    .addComponents(buttons)
            ]
        );
    };

    // =========================
    // START GUARDIAN
    // =========================

    const startGuardian = async () => {
        const guardian =
            getAliveByRole("guardian")[0];

        if (!guardian) {
            await startWitch();
            return;
        }

        session.nightStep =
            "guardian";

        const targets =
            getAlivePlayers();

        await channel.send(
            "🛡️ **Bảo Vệ đang hành động...**"
        );

        await sendDM(
            guardian.id,
            "Bạn là **Bảo Vệ**.\n" +
            "Chọn một người để bảo vệ.",
            createTargetButtons(
                "guardian",
                targets
            )
        );
    };

    // =========================
    // START WOLVES
    // =========================

    const startWolves = async () => {
        const wolves =
            getAliveByRole("wolf");

        if (!wolves.length) {
            await startGuardian();
            return;
        }

        session.nightStep =
            "wolves";

        const targets =
            getAlivePlayers()
                .filter(
                    player =>
                        getRole(player.id) !== "wolf"
                );

        await channel.send(
            `🐺 **Sói đang hành động...**\n` +
            `Có ${wolves.length} Sói đang sống.`
        );

        for (const wolf of wolves) {
            await sendDM(
                wolf.id,
                "Bạn là **Sói**.\n" +
                "Chọn một người để giết đêm nay.\n\n" +
                "Phải chờ tất cả Sói chọn xong.",
                createTargetButtons(
                    "wolf",
                    targets
                )
            );
        }
    };

    // =========================
    // START NIGHT
    // =========================

    const startNight = async () => {
        if (session.phase === "ended") {
            return;
        }

        session.phase =
            "night";

        session.night++;

        session.nightActions.clear();

        await channel.send(
            `🌙 **BUỔI ĐÊM ${session.night}**\n\n` +
            `Mọi người đi ngủ.\n` +
            `Các vai trò sẽ hành động theo thứ tự.`
        );

        await startWolves();
    };

    // =========================
    // START DAY
    // =========================

    const startDay = async () => {
        if (session.phase === "ended") {
            return;
        }

        session.phase =
            "day_discussion";

        session.day++;

        session.votes.clear();

        await channel.send(
            `☀️ **NGÀY ${session.day}**\n\n` +
            `Mọi người bắt đầu thảo luận.\n\n` +
            `Trưởng Làng: ${
                session.mayorId
                    ? `<@${session.mayorId}>`
                    : "Chưa có"
            }\n\n` +
            `Khi thảo luận xong, Game Master có thể mở bỏ phiếu.`
        );
    };

    // =========================
    // START VOTE
    // =========================

    const startVote = async () => {
        if (session.phase !== "day_discussion") {
            return false;
        }

        session.phase =
            "day_vote";

        session.votes.clear();

        const alive =
            getAlivePlayers();

        const buttons =
            createTargetButtons(
                "vote",
                alive
            );

        // Phiếu trắng
        if (buttons.length > 0) {
            const lastRow =
                buttons[buttons.length - 1];

            if (lastRow.components.length < 5) {
                lastRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(
                            `masoi_vote_${session.guildId}_blank`
                        )
                        .setLabel("Phiếu trắng")
                        .setStyle(
                            ButtonStyle.Secondary
                        )
                );
            } else {
                buttons.push(
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(
                                    `masoi_vote_${session.guildId}_blank`
                                )
                                .setLabel("Phiếu trắng")
                                .setStyle(
                                    ButtonStyle.Secondary
                                )
                        )
                );
            }
        }

        await channel.send(
            `🗳️ **BỎ PHIẾU NGÀY ${session.day}**\n\n` +
            `Mỗi người sống phải bỏ một phiếu.\n` +
            `Có thể chọn **Phiếu trắng**.`
        );

        for (const player of alive) {
            await sendDM(
                player.id,
                `🗳️ **Bỏ phiếu**\n\n` +
                `Chọn người bạn muốn treo cổ.`,
                buttons
            );
        }

        return true;
    };

    // =========================
    // RESOLVE VOTE
    // =========================

    const resolveVote = async () => {
        session.phase =
            "resolving_vote";

        const counts =
            new Map();

        for (const [voterId, targetId] of session.votes) {
            let power = 1;

            if (
                voterId === session.mayorId &&
                isAlive(voterId)
            ) {
                power = 2;
            }

            const key =
                targetId || "blank";

            counts.set(
                key,
                (counts.get(key) || 0) + power
            );
        }

        if (counts.size === 0) {
            await startNight();
            return;
        }

        const maxVotes =
            Math.max(
                ...counts.values()
            );

        const winners =
            [...counts.entries()]
                .filter(
                    ([, count]) =>
                        count === maxVotes
                )
                .map(
                    ([targetId]) =>
                        targetId
                );

        const blankVotes =
            counts.get("blank") || 0;

        // Hòa
        if (winners.length !== 1) {
            await channel.send(
                `🗳️ **Kết quả bỏ phiếu**\n\n` +
                `Có kết quả hòa.\n` +
                `Không ai bị treo cổ.`
            );

            await startNight();
            return;
        }

        const eliminated =
            winners[0];

        // Phiếu trắng thắng
        if (eliminated === "blank") {
            await channel.send(
                `🗳️ **Kết quả bỏ phiếu**\n\n` +
                `Phiếu trắng cao nhất với **${blankVotes} phiếu**.\n` +
                `Không ai bị treo cổ.`
            );

            await startNight();
            return;
        }

        await killPlayer(
            eliminated
        );

        const role =
            getRole(eliminated);

        await channel.send(
            `🗳️ **Kết quả bỏ phiếu**\n\n` +
            `<@${eliminated}> bị treo cổ.\n` +
            `Vai trò: **${roleNames[role]}**.`
        );

        // Trưởng làng chết
        if (
            eliminated === session.mayorId
        ) {
            session.mayorId = null;

            await channel.send(
                "👑 Trưởng Làng đã chết.\n" +
                "Chức vụ Trưởng Làng hiện đang trống."
            );
        }

        if (
            role === "hunter"
        ) {
            await startHunterAction(
                eliminated
            );

            return;
        }

        if (await checkWin()) {
            return;
        }

        await startNight();
    };

    // =========================
    // BUTTON HANDLER
    // =========================

    const buttonHandler = async interaction => {
        if (!interaction.isButton()) {
            return;
        }

        if (
            interaction.guildId !==
            session.guildId
        ) {
            return;
        }

        const parts =
            interaction.customId.split("_");

        if (parts[0] !== "masoi") {
            return;
        }

        const action =
            parts[1];

        // =========================
        // LOBBY
        // =========================

        if (
            action === "join" ||
            action === "leave" ||
            action === "begin"
        ) {
            if (
                session.phase !== "lobby"
            ) {
                return interaction.reply({
                    content:
                        "Lobby đã đóng.",
                    ephemeral: true
                });
            }

            if (action === "join") {
                if (
                    session.players.has(
                        interaction.user.id
                    )
                ) {
                    return interaction.reply({
                        content:
                            "Bạn đã tham gia.",
                        ephemeral: true
                    });
                }

                session.players.set(
                    interaction.user.id,
                    {
                        id:
                            interaction.user.id,
                        username:
                            interaction.user.username
                    }
                );

                await interaction.reply({
                    content:
                        "Bạn đã tham gia Ma Sói.",
                    ephemeral: true
                });

                await updateLobby();

                return;
            }

            if (action === "leave") {
                if (
                    !session.players.has(
                        interaction.user.id
                    )
                ) {
                    return interaction.reply({
                        content:
                            "Bạn chưa tham gia.",
                        ephemeral: true
                    });
                }

                session.players.delete(
                    interaction.user.id
                );

                await interaction.reply({
                    content:
                        "Bạn đã rời Ma Sói.",
                    ephemeral: true
                });

                await updateLobby();

                return;
            }

            if (action === "begin") {
                if (
                    interaction.user.id !==
                    session.gameMasterId
                ) {
                    return interaction.reply({
                        content:
                            "Chỉ Game Master mới có thể bắt đầu.",
                        ephemeral: true
                    });
                }

                if (
                    session.players.size < 3
                ) {
                    return interaction.reply({
                        content:
                            "Cần ít nhất 3 người chơi.",
                        ephemeral: true
                    });
                }

                await interaction.deferUpdate();

                session.phase =
                    "starting";

                await interaction.message.edit({
                    components: []
                }).catch(() => {});

                assignRoles();

                await channel.send(
                    `🐺 **VÁN MA SÓI BẮT ĐẦU!**\n\n` +
                    `Số người chơi: **${session.players.size}**`
                );

                await sendRoleInfo();

                await startNight();

                return;
            }
        }

        // =========================
        // GAME MASTER: START VOTE
        // =========================

        if (
            action === "startvote"
        ) {
            if (
                session.phase !==
                "day_discussion"
            ) {
                return interaction.reply({
                    content:
                        "Hiện chưa thể mở bỏ phiếu.",
                    ephemeral: true
                });
            }

            if (
                interaction.user.id !==
                session.gameMasterId
            ) {
                return interaction.reply({
                    content:
                        "Chỉ Game Master mới có thể mở bỏ phiếu.",
                    ephemeral: true
                });
            }

            await interaction.deferUpdate();

            await startVote();

            return;
        }

        // =========================
        // NIGHT ACTIONS
        // =========================

        if (
            action === "wolf" ||
            action === "guardian" ||
            action === "seer" ||
            action === "hunter"
        ) {
            const targetId =
                parts[3];

            if (
                !isAlive(
                    interaction.user.id
                ) &&
                action !== "hunter"
            ) {
                return interaction.reply({
                    content:
                        "Bạn đã chết.",
                    ephemeral: true
                });
            }

            // Đảm bảo đúng phase
            if (
                action === "wolf" &&
                session.nightStep !== "wolves"
            ) {
                return interaction.reply({
                    content:
                        "Hiện chưa đến lượt Sói.",
                    ephemeral: true
                });
            }

            if (
                action === "guardian" &&
                session.nightStep !== "guardian"
            ) {
                return interaction.reply({
                    content:
                        "Hiện chưa đến lượt Bảo Vệ.",
                    ephemeral: true
                });
            }

            if (
                action === "seer" &&
                session.nightStep !== "seer"
            ) {
                return interaction.reply({
                    content:
                        "Hiện chưa đến lượt Tiên Tri.",
                    ephemeral: true
                });
            }

            if (
                action === "hunter" &&
                session.phase !== "hunter"
            ) {
                return interaction.reply({
                    content:
                        "Hiện không phải lượt của Thợ Săn.",
                    ephemeral: true
                });
            }

            if (
                !isAlive(targetId)
            ) {
                return interaction.reply({
                    content:
                        "Người này đã chết.",
                    ephemeral: true
                });
            }

            if (
                targetId ===
                interaction.user.id
            ) {
                return interaction.reply({
                    content:
                        "Bạn không thể chọn chính mình.",
                    ephemeral: true
                });
            }

            const role =
                getRole(
                    interaction.user.id
                );

            if (
                action === "wolf" &&
                role !== "wolf"
            ) {
                return interaction.reply({
                    content:
                        "Bạn không phải Sói.",
                    ephemeral: true
                });
            }

            if (
                action === "guardian" &&
                role !== "guardian"
            ) {
                return interaction.reply({
                    content:
                        "Bạn không phải Bảo Vệ.",
                    ephemeral: true
                });
            }

            if (
                action === "seer" &&
                role !== "seer"
            ) {
                return interaction.reply({
                    content:
                        "Bạn không phải Tiên Tri.",
                    ephemeral: true
                });
            }

            if (
                action === "hunter" &&
                role !== "hunter"
            ) {
                return interaction.reply({
                    content:
                        "Bạn không phải Thợ Săn.",
                    ephemeral: true
                });
            }

            // Sói không giết Sói
            if (
                action === "wolf" &&
                getRole(targetId) === "wolf"
            ) {
                return interaction.reply({
                    content:
                        "Sói không thể chọn Sói khác.",
                    ephemeral: true
                });
            }

            // Tiên tri
            if (
                action === "seer"
            ) {
                const targetRole =
                    getRole(targetId);

                await interaction.reply({
                    content:
                        `<@${targetId}> là **${roleNames[targetRole]}**.`,
                    ephemeral: true
                });

                session.nightActions.set(
                    interaction.user.id,
                    {
                        action:
                            "seer",
                        targetId
                    }
                );

                // Tiên tri xong
                await startGuardian();

                return;
            }

            // Hunter
            if (
                action === "hunter"
            ) {
                await interaction.reply({
                    content:
                        `Bạn đã bắn <@${targetId}>.`,
                    ephemeral: true
                });

                await killPlayer(
                    targetId
                );

                await channel.send(
                    `🔫 <@${interaction.user.id}> ` +
                    `đã bắn <@${targetId}>.`
                );

                if (
                    getRole(targetId) ===
                    "hunter"
                ) {
                    await startHunterAction(
                        targetId
                    );

                    return;
                }

                if (
                    await checkWin()
                ) {
                    return;
                }

                if (
                    session.nightStep
                ) {
                    await finishNight();
                } else {
                    await startNight();
                }

                return;
            }

            // Guardian
            if (
                action === "guardian"
            ) {
                session.nightActions.set(
                    "guardian",
                    targetId
                );

                await interaction.reply({
                    content:
                        `Bạn đã bảo vệ <@${targetId}>.`,
                    ephemeral: true
                });

                await startWitch();

                return;
            }

            // =========================
            // WOLF
            // =========================

            if (
                action === "wolf"
            ) {
                session.nightActions.set(
                    interaction.user.id,
                    {
                        action:
                            "wolf",
                        targetId
                    }
                );

                await interaction.reply({
                    content:
                        `Đã chọn <@${targetId}>.`,
                    ephemeral: true
                });

                const wolves =
                    getAliveByRole(
                        "wolf"
                    );

                const allWolvesActed =
                    wolves.every(
                        wolf =>
                            session.nightActions.has(
                                wolf.id
                            )
                    );

                if (
                    !allWolvesActed
                ) {
                    await interaction.followUp({
                        content:
                            "Đã ghi nhận. Đang chờ các Sói khác.",
                        ephemeral: true
                    }).catch(() => {});

                    return;
                }

                // Lấy mục tiêu của Sói
                const wolfTargets =
                    wolves.map(
                        wolf =>
                            session.nightActions.get(
                                wolf.id
                            )?.targetId
                    );

                // Nếu Sói chọn khác nhau,
                // lấy mục tiêu có nhiều lựa chọn nhất.
                const counts =
                    new Map();

                for (
                    const target of wolfTargets
                ) {
                    counts.set(
                        target,
                        (counts.get(target) || 0) + 1
                    );
                }

                const max =
                    Math.max(
                        ...counts.values()
                    );

                const selected =
                    [...counts.entries()]
                        .filter(
                            ([, count]) =>
                                count === max
                        )
                        .map(
                            ([target]) =>
                                target
                        );

                // Hòa giữa Sói
                if (
                    selected.length > 1
                ) {
                    session.nightActions.set(
                        "wolf",
                        null
                    );
                } else {
                    session.nightActions.set(
                        "wolf",
                        selected[0]
                    );
                }

                await startGuardian();

                return;
            }
        }

        // =========================
        // WITCH
        // =========================

        if (
            action === "witchheal"
        ) {
            if (
                session.phase !== "night" ||
                session.nightStep !== "witch"
            ) {
                return interaction.reply({
                    content:
                        "Hiện chưa đến lượt Phù Thủy.",
                    ephemeral: true
                });
            }

            if (
                getRole(
                    interaction.user.id
                ) !== "witch"
            ) {
                return interaction.reply({
                    content:
                        "Bạn không phải Phù Thủy.",
                    ephemeral: true
                });
            }

            if (
                session.witchHealUsed
            ) {
                return interaction.reply({
                    content:
                        "Bạn đã dùng thuốc cứu.",
                    ephemeral: true
                });
            }

            const target =
                session.nightActions.get(
                    "wolf"
                );

            if (!target) {
                return interaction.reply({
                    content:
                        "Không có người bị Sói chọn để cứu.",
                    ephemeral: true
                });
            }

            session.witchHealUsed =
                true;

            session.nightActions.set(
                "witch_heal",
                target
            );

            await interaction.reply({
                content:
                    `Bạn đã cứu <@${target}>.`,
                ephemeral: true
            });

            await startSeer();

            return;
        }

        if (
            action === "witchskip"
        ) {
            if (
                session.nightStep !==
                "witch"
            ) {
                return interaction.reply({
                    content:
                        "Hiện chưa đến lượt Phù Thủy.",
                    ephemeral: true
                });
            }

            await interaction.reply({
                content:
                    "Bạn đã bỏ qua hành động.",
                ephemeral: true
            });

            await startSeer();

            return;
        }

        if (
            action === "witchkill"
        ) {
            if (
                session.nightStep !==
                "witch"
            ) {
                return interaction.reply({
                    content:
                        "Hiện chưa đến lượt Phù Thủy.",
                    ephemeral: true
                });
            }

            if (
                getRole(
                    interaction.user.id
                ) !== "witch"
            ) {
                return interaction.reply({
                    content:
                        "Bạn không phải Phù Thủy.",
                    ephemeral: true
                });
            }

            if (
                session.witchKillUsed
            ) {
                return interaction.reply({
                    content:
                        "Bạn đã dùng thuốc độc.",
                    ephemeral: true
                });
            }

            session.witchKillUsed =
                true;

            const targets =
                getAlivePlayers()
                    .filter(
                        player =>
                            player.id !==
                            interaction.user.id
                    );

            await interaction.reply({
                content:
                    "Chọn người muốn đầu độc.",
                components:
                    createTargetButtons(
                        "witchpoison",
                        targets
                    ),
                ephemeral: true
            });

            return;
        }

        // =========================
        // WITCH POISON
        // =========================

        if (
            action === "witchpoison"
        ) {
            if (
                session.nightStep !==
                "witch"
            ) {
                return interaction.reply({
                    content:
                        "Đã hết lượt Phù Thủy.",
                    ephemeral: true
                });
            }

            const targetId =
                parts[3];

            if (
                !isAlive(targetId)
            ) {
                return interaction.reply({
                    content:
                        "Người này đã chết.",
                    ephemeral: true
                });
            }

            session.nightActions.set(
                "witch_kill",
                targetId
            );

            await interaction.reply({
                content:
                    `Đã đầu độc <@${targetId}>.`,
                ephemeral: true
            });

            await startSeer();

            return;
        }

        // =========================
        // VOTE
        // =========================

        if (
            action === "vote"
        ) {
            if (
                session.phase !==
                "day_vote"
            ) {
                return interaction.reply({
                    content:
                        "Hiện không phải lúc bỏ phiếu.",
                    ephemeral: true
                });
            }

            const voterId =
                interaction.user.id;

            if (
                !isAlive(voterId)
            ) {
                return interaction.reply({
                    content:
                        "Bạn đã chết.",
                    ephemeral: true
                });
            }

            if (
                session.votes.has(
                    voterId
                )
            ) {
                return interaction.reply({
                    content:
                        "Bạn đã bỏ phiếu rồi.",
                    ephemeral: true
                });
            }

            const targetId =
                parts[3];

            if (
                targetId !== "blank" &&
                !isAlive(targetId)
            ) {
                return interaction.reply({
                    content:
                        "Người này đã chết.",
                    ephemeral: true
                });
            }

            if (
                targetId === voterId
            ) {
                return interaction.reply({
                    content:
                        "Bạn không thể tự vote chính mình.",
                    ephemeral: true
                });
            }

            session.votes.set(
                voterId,
                targetId === "blank"
                    ? null
                    : targetId
            );

            await interaction.reply({
                content:
                    targetId === "blank"
                        ? "Bạn đã chọn **Phiếu trắng**."
                        : `Bạn đã vote <@${targetId}>.`,
                ephemeral: true
            });

            const alive =
                getAlivePlayers();

            const allVoted =
                alive.every(
                    player =>
                        session.votes.has(
                            player.id
                        )
                );

            if (
                allVoted
            ) {
                await resolveVote();
            }

            return;
        }
    };

    // =========================
    // SAVE HANDLER
    // =========================

    session.buttonHandler =
        buttonHandler;

    client.on(
        "interactionCreate",
        buttonHandler
    );

    // =========================
    // INITIAL LOBBY
    // =========================

    await updateLobby();
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
