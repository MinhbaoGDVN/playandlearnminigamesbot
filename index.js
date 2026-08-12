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
            client.off(
                "messageCreate",
                session.messageHandler
            );
        }
    
        if (session.buttonHandler) {
            client.off(
                "interactionCreate",
                session.buttonHandler
            );
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
        client.off(
            "messageCreate",
            session.messageHandler
        );
    }

    if (session.buttonHandler) {
        client.off(
            "interactionCreate",
            session.buttonHandler
        );
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

    /*
    ============================================================
    SESSION
    ============================================================
    */

    session.phase = "lobby";

    session.players = new Map();
    session.roles = new Map();
    session.alivePlayers = new Set();

    session.night = 0;
    session.day = 0;

    session.nightStep = null;
    session.nightActions = new Map();
    session.voteResults = new Map();

    session.witchHealUsed = false;
    session.witchKillUsed = false;

    session.lobbyMessage = null;
    session.buttonHandler = null;

    /*
    ============================================================
    ROLE NAMES
    ============================================================
    */

    const roleNames = {
        wolf: "Sói",
        villager: "Dân Làng",
        seer: "Tiên Tri",
        guardian: "Bảo Vệ",
        witch: "Phù Thủy",
        hunter: "Thợ Săn"
    };

    /*
    ============================================================
    HELPERS
    ============================================================
    */

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
            .filter(player => isAlive(player.id));
    };

    const getAliveRolePlayers = role => {
        return getAlivePlayers()
            .filter(player => getRole(player.id) === role);
    };

    /*
    ============================================================
    TARGET BUTTONS
    ============================================================
    
    Discord tối đa 5 rows.
    Mỗi row tối đa 5 buttons.
    => tối đa 25 target buttons.
    */

    const createTargetButtons = (action, players) => {
        const rows = [];
        let buttons = [];

        for (const player of players.slice(0, 25)) {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(
                        `masoi_${action}_${session.guildId}_${player.id}`
                    )
                    .setLabel(
                        player.username.slice(0, 80)
                    )
                    .setStyle(ButtonStyle.Primary)
            );

            if (buttons.length === 5) {
                rows.push(
                    new ActionRowBuilder()
                        .addComponents(buttons)
                );

                buttons = [];
            }
        }

        if (buttons.length) {
            rows.push(
                new ActionRowBuilder()
                    .addComponents(buttons)
            );
        }

        return rows;
    };

    /*
    ============================================================
    PRIVATE ACTION MESSAGE
    ============================================================
    */

    const privateAction = async (
        interaction,
        content,
        components = []
    ) => {
        if (interaction.replied || interaction.deferred) {
            return interaction.editReply({
                content,
                components
            }).catch(() => {});
        }

        return interaction.reply({
            content,
            components,
            ephemeral: true
        });
    };

    /*
    ============================================================
    WIN CHECK
    ============================================================
    */

    const checkWin = async () => {
        if (
            session.phase === "ended" ||
            session.phase === "lobby"
        ) {
            return true;
        }

        const alive = getAlivePlayers();

        const wolves = alive.filter(player =>
            getRole(player.id) === "wolf"
        );

        const villagers = alive.filter(player =>
            getRole(player.id) !== "wolf"
        );

        if (wolves.length === 0) {
            session.phase = "ended";
            session.nightStep = null;

            await channel.send(
                "🏆 **Dân Làng thắng!**\n" +
                "Tất cả Sói đã bị loại."
            );

            return true;
        }

        if (wolves.length >= villagers.length) {
            session.phase = "ended";
            session.nightStep = null;

            await channel.send(
                "🐺 **Sói thắng!**\n" +
                "Số Sói đã bằng hoặc vượt số người không phải Sói."
            );

            return true;
        }

        return false;
    };

    /*
    ============================================================
    KILL
    ============================================================
    */

    const killPlayer = playerId => {
        if (!isAlive(playerId)) {
            return false;
        }

        session.alivePlayers.delete(playerId);

        return true;
    };

    /*
    ============================================================
    LOBBY
    ============================================================
    */

    const updateLobby = async () => {
        const players = [...session.players.values()];

        const list = players.length
            ? players.map((player, index) =>
                `${index + 1}. <@${player.id}>`
            ).join("\n")
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

        const row = new ActionRowBuilder()
            .addComponents(buttons);

        if (session.lobbyMessage) {
            await session.lobbyMessage.edit({
                embeds: [embed],
                components: [row]
            }).catch(() => {});
        } else {
            session.lobbyMessage = await channel.send({
                embeds: [embed],
                components: [row]
            });
        }
    };

    /*
    ============================================================
    ROLE ASSIGNMENT
    ============================================================
    */

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
    };

    /*
    ============================================================
    START NIGHT
    ============================================================
    */

    const startNight = async () => {
        if (session.phase === "ended") {
            return;
        }

        session.phase = "night";
        session.night++;

        session.nightActions.clear();

        await channel.send(
            `🌙 **Buổi đêm ${session.night} bắt đầu.**`
        );

        /*
        Nếu không còn Sói thì chuyển thẳng sang xử lý.
        */

        const wolves = getAliveRolePlayers("wolf");

        if (wolves.length === 0) {
            await checkWin();
            return;
        }

        session.nightStep = "wolf";

        await channel.send({
            content:
                "🐺 **Lượt Sói**\n" +
                "Các Sói hãy thực hiện hành động.",

            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(
                            `masoi_action_${session.guildId}`
                        )
                        .setLabel("Hành động của tôi")
                        .setStyle(ButtonStyle.Primary)
                )
            ]
        });
    };

    /*
    ============================================================
    START SEER
    ============================================================
    */

    const startSeer = async () => {
        if (session.phase === "ended") {
            return;
        }

        const seer = getAliveRolePlayers("seer")[0];

        if (!seer) {
            return startGuardian();
        }

        session.nightStep = "seer";

        await channel.send(
            "🔮 **Lượt Tiên Tri**\n" +
            "Tiên Tri hãy thực hiện hành động."
        );

        await channel.send({
            content:
                `<@${seer.id}> hãy nhấn **Hành động của tôi**.`,

            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(
                            `masoi_action_${session.guildId}`
                        )
                        .setLabel("Hành động của tôi")
                        .setStyle(ButtonStyle.Primary)
                )
            ]
        });
    };

    /*
    ============================================================
    START GUARDIAN
    ============================================================
    */

    const startGuardian = async () => {
        if (session.phase === "ended") {
            return;
        }

        const guardian =
            getAliveRolePlayers("guardian")[0];

        if (!guardian) {
            return startWitch();
        }

        session.nightStep = "guardian";

        await channel.send(
            "🛡️ **Lượt Bảo Vệ**\n" +
            "Bảo Vệ hãy thực hiện hành động."
        );

        await channel.send({
            content:
                `<@${guardian.id}> hãy nhấn **Hành động của tôi**.`,

            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(
                            `masoi_action_${session.guildId}`
                        )
                        .setLabel("Hành động của tôi")
                        .setStyle(ButtonStyle.Primary)
                )
            ]
        });
    };

    /*
    ============================================================
    START WITCH
    ============================================================
    */

    const startWitch = async () => {
        if (session.phase === "ended") {
            return;
        }

        const witch =
            getAliveRolePlayers("witch")[0];

        if (!witch) {
            return resolveNight();
        }

        session.nightStep = "witch";

        await channel.send(
            "🧪 **Lượt Phù Thủy**\n" +
            "Phù Thủy hãy thực hiện hành động."
        );

        await channel.send({
            content:
                `<@${witch.id}> hãy nhấn **Hành động của tôi**.`,

            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(
                            `masoi_action_${session.guildId}`
                        )
                        .setLabel("Hành động của tôi")
                        .setStyle(ButtonStyle.Primary)
                )
            ]
        });
    };

    /*
    ============================================================
    RESOLVE NIGHT
    ============================================================
    */

    const resolveNight = async () => {
        if (
            session.phase !== "night" ||
            session.nightStep === "resolve"
        ) {
            return;
        }

        session.nightStep = "resolve";

        const wolfTarget =
            session.nightActions.get("wolf");

        const protectedTarget =
            session.nightActions.get("guardian");

        const witchHeal =
            session.nightActions.get("witch_heal");

        const witchKill =
            session.nightActions.get("witch_kill");

        const deaths = [];

        /*
        Sói giết
        */

        if (
            wolfTarget &&
            wolfTarget !== protectedTarget &&
            wolfTarget !== witchHeal &&
            isAlive(wolfTarget)
        ) {
            deaths.push(wolfTarget);
        }

        /*
        Phù Thủy giết
        */

        if (
            witchKill &&
            isAlive(witchKill) &&
            !deaths.includes(witchKill)
        ) {
            deaths.push(witchKill);
        }

        /*
        Xử lý chết
        */

        for (const playerId of deaths) {
            killPlayer(playerId);
        }

        /*
        BUỔI SÁNG
        */

        await channel.send(
            `☀️ **Buổi sáng ${session.day + 1}.**`
        );

        if (deaths.length === 0) {
            await channel.send(
                "Đêm qua không có ai chết."
            );
        } else {
            await channel.send(
                deaths
                    .map(id => `<@${id}>`)
                    .join(", ") +
                (
                    deaths.length === 1
                        ? " đã chết trong đêm."
                        : " đã chết trong đêm."
                )
            );
        }

        /*
        Hunter chết thì kích hoạt sau khi thông báo.
        */

        for (const playerId of deaths) {
            if (getRole(playerId) === "hunter") {
                await channel.send(
                    `🏹 <@${playerId}> là **Thợ Săn** và ` +
                    `có quyền chọn một người để bắn.`
                );
            }
        }

        session.nightActions.clear();

        if (await checkWin()) {
            return;
        }

        await startDay();
    };

    /*
    ============================================================
    START DAY
    ============================================================
    */

    const startDay = async () => {
        if (session.phase === "ended") {
            return;
        }

        session.phase = "day";
        session.day++;

        session.voteResults.clear();

        await channel.send(
            `☀️ **Ngày ${session.day} bắt đầu.**\n` +
            `Mọi người có thể thảo luận.`
        );

        await channel.send({
            content:
                "🗳️ Khi đã sẵn sàng, hãy nhấn **Bỏ phiếu**.",

            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(
                            `masoi_voteopen_${session.guildId}`
                        )
                        .setLabel("Bỏ phiếu")
                        .setStyle(ButtonStyle.Primary)
                )
            ]
        });
    };

    /*
    ============================================================
    OPEN VOTE
    ============================================================
    */

    const openVote = async interaction => {
        if (session.phase !== "day") {
            return privateAction(
                interaction,
                "Hiện tại chưa đến thời gian bỏ phiếu."
            );
        }

        if (!isAlive(interaction.user.id)) {
            return privateAction(
                interaction,
                "Bạn đã chết."
            );
        }

        /*
        Nếu người này đã vote rồi
        */

        if (
            session.voteResults.has(
                interaction.user.id
            )
        ) {
            return privateAction(
                interaction,
                "Bạn đã bỏ phiếu rồi."
            );
        }

        const targets = getAlivePlayers()
            .filter(player =>
                player.id !== interaction.user.id
            );

        const rows = createTargetButtons(
            "vote",
            targets
        );

        /*
        Phiếu trắng
        */

        if (rows.length < 5) {
            rows.push(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(
                            `masoi_blank_${session.guildId}`
                        )
                        .setLabel("Phiếu trắng")
                        .setStyle(ButtonStyle.Secondary)
                )
            );
        }

        return privateAction(
            interaction,

            "🗳️ **Bỏ phiếu**\n" +
            "Chọn người bạn muốn treo cổ hoặc bỏ phiếu trắng.",

            rows
        );
    };

    /*
    ============================================================
    RESOLVE VOTES
    ============================================================
    */

    const resolveVotes = async () => {
        if (session.phase !== "day") {
            return;
        }

        session.phase = "vote_resolve";

        const counts = new Map();

        for (const targetId of session.voteResults.values()) {
            if (!targetId) {
                continue;
            }

            counts.set(
                targetId,
                (counts.get(targetId) || 0) + 1
            );
        }

        /*
        Tất cả trắng
        */

        if (counts.size === 0) {
            await channel.send(
                "🗳️ **Kết quả bỏ phiếu**\n" +
                "Tất cả đều bỏ phiếu trắng.\n" +
                "Không ai bị loại."
            );

            session.voteResults.clear();

            await startNight();

            return;
        }

        const maxVotes =
            Math.max(...counts.values());

        const winners = [...counts.entries()]
            .filter(([id, count]) =>
                count === maxVotes
            )
            .map(([id]) => id);

        /*
        Hòa
        */

        if (winners.length !== 1) {
            await channel.send(
                "🗳️ **Kết quả bỏ phiếu**\n" +
                "Kết quả hòa.\n" +
                "Không ai bị loại."
            );

            session.voteResults.clear();

            await startNight();

            return;
        }

        const eliminated = winners[0];

        if (!isAlive(eliminated)) {
            session.voteResults.clear();

            await startNight();

            return;
        }

        const player = getPlayer(eliminated);
        const role = getRole(eliminated);

        killPlayer(eliminated);

        await channel.send(
            `⚖️ <@${player.id}> đã bị treo cổ.\n` +
            `Vai trò: **${roleNames[role] || role}**.`
        );

        session.voteResults.clear();

        if (await checkWin()) {
            return;
        }

        await startNight();
    };

    /*
    ============================================================
    BUTTON HANDLER
    ============================================================
    */

    const buttonHandler = async interaction => {
        if (!interaction.isButton()) {
            return;
        }

        if (interaction.guildId !== session.guildId) {
            return;
        }

        const customId =
            interaction.customId;

        if (!customId.startsWith("masoi_")) {
            return;
        }

        const parts =
            customId.split("_");

        const action = parts[1];

        /*
        ========================================================
        LOBBY JOIN
        ========================================================
        */

        if (action === "join") {
            if (session.phase !== "lobby") {
                return privateAction(
                    interaction,
                    "Lobby đã đóng."
                );
            }

            if (session.players.has(interaction.user.id)) {
                return privateAction(
                    interaction,
                    "Bạn đã tham gia rồi."
                );
            }

            session.players.set(
                interaction.user.id,
                {
                    id: interaction.user.id,
                    username: interaction.user.username
                }
            );

            await privateAction(
                interaction,
                "Bạn đã tham gia Ma Sói."
            );

            await updateLobby();

            return;
        }

        /*
        ========================================================
        LOBBY LEAVE
        ========================================================
        */

        if (action === "leave") {
            if (session.phase !== "lobby") {
                return privateAction(
                    interaction,
                    "Lobby đã đóng."
                );
            }

            if (!session.players.has(interaction.user.id)) {
                return privateAction(
                    interaction,
                    "Bạn chưa tham gia."
                );
            }

            session.players.delete(
                interaction.user.id
            );

            await privateAction(
                interaction,
                "Bạn đã rời Ma Sói."
            );

            await updateLobby();

            return;
        }

        /*
        ========================================================
        BEGIN
        ========================================================
        */

        if (action === "begin") {
            if (
                interaction.user.id !==
                session.gameMasterId
            ) {
                return privateAction(
                    interaction,
                    "Chỉ Game Master mới có thể bắt đầu."
                );
            }

            if (session.players.size < 3) {
                return privateAction(
                    interaction,
                    "Cần ít nhất 3 người chơi."
                );
            }

            session.phase = "starting";

            await interaction.update({
                components: []
            });

            assignRoles();

            await channel.send(
                `🐺 **Ván Ma Sói bắt đầu!**\n` +
                `Có **${session.players.size} người chơi**.\n` +
                `Vai trò đã được phân phối bí mật.`
            );

            /*
            KHÔNG gửi role ra channel.
            */

            await startNight();

            return;
        }

        /*
        ========================================================
        ACTION MENU
        ========================================================
        */

        if (action === "action") {
            if (session.phase !== "night") {
                return privateAction(
                    interaction,
                    "Hiện tại không phải buổi đêm."
                );
            }

            const playerId =
                interaction.user.id;

            if (!session.players.has(playerId)) {
                return privateAction(
                    interaction,
                    "Bạn không tham gia ván này."
                );
            }

            if (!isAlive(playerId)) {
                return privateAction(
                    interaction,
                    "Bạn đã chết."
                );
            }

            const role =
                getRole(playerId);

            /*
            Sói
            */

            if (role === "wolf") {
                if (session.nightStep !== "wolf") {
                    return privateAction(
                        interaction,
                        "Hiện tại chưa đến lượt Sói."
                    );
                }

                const wolves =
                    getAliveRolePlayers("wolf");

                const targets =
                    getAlivePlayers().filter(player =>
                        getRole(player.id) !== "wolf"
                    );

                const chosen =
                    session.nightActions.get(
                        `wolf_${playerId}`
                    );

                return privateAction(
                    interaction,

                    chosen
                        ? `🐺 Bạn đã chọn <@${chosen}>.\n` +
                          `Các Sói khác vẫn đang chọn.`
                        : "🐺 **Bạn là Sói.**\n\n" +
                          "Chọn một người để giết đêm nay.",

                    chosen
                        ? []
                        : createTargetButtons(
                            "wolf",
                            targets
                        )
                );
            }

            /*
            Tiên Tri
            */

            if (role === "seer") {
                if (session.nightStep !== "seer") {
                    return privateAction(
                        interaction,
                        "Hiện tại chưa đến lượt Tiên Tri."
                    );
                }

                const targets =
                    getAlivePlayers().filter(player =>
                        player.id !== playerId
                    );

                return privateAction(
                    interaction,

                    "🔮 **Bạn là Tiên Tri.**\n" +
                    "Chọn một người để soi.",

                    createTargetButtons(
                        "seer",
                        targets
                    )
                );
            }

            /*
            Bảo Vệ
            */

            if (role === "guardian") {
                if (session.nightStep !== "guardian") {
                    return privateAction(
                        interaction,
                        "Hiện tại chưa đến lượt Bảo Vệ."
                    );
                }

                return privateAction(
                    interaction,

                    "🛡️ **Bạn là Bảo Vệ.**\n" +
                    "Chọn một người để bảo vệ.",

                    createTargetButtons(
                        "guardian",
                        getAlivePlayers()
                    )
                );
            }

            /*
            Phù Thủy
            */

            if (role === "witch") {
                if (session.nightStep !== "witch") {
                    return privateAction(
                        interaction,
                        "Hiện tại chưa đến lượt Phù Thủy."
                    );
                }

                const rows = [];

                const wolfTarget =
                    session.nightActions.get("wolf");

                /*
                Thuốc cứu
                */

                if (
                    wolfTarget &&
                    !session.witchHealUsed
                ) {
                    rows.push(
                        new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(
                                        `masoi_witchheal_${session.guildId}`
                                    )
                                    .setLabel(
                                        "Dùng thuốc cứu"
                                    )
                                    .setStyle(
                                        ButtonStyle.Success
                                    )
                            )
                    );
                }

                /*
                Thuốc độc
                */

                if (!session.witchKillUsed) {
                    rows.push(
                        ...createTargetButtons(
                            "witchkill",
                            getAlivePlayers().filter(
                                player =>
                                    player.id !== playerId
                            )
                        )
                    );
                }

                /*
                Nút bỏ qua
                */

                if (rows.length < 5) {
                    rows.push(
                        new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(
                                        `masoi_witchskip_${session.guildId}`
                                    )
                                    .setLabel(
                                        "Không sử dụng thuốc"
                                    )
                                    .setStyle(
                                        ButtonStyle.Secondary
                                    )
                            )
                    );
                }

                return privateAction(
                    interaction,

                    "🧪 **Bạn là Phù Thủy.**\n" +
                    "Bạn có thể sử dụng thuốc hoặc bỏ qua.",

                    rows
                );
            }

            return privateAction(
                interaction,
                `Vai trò của bạn là **${roleNames[role] || role}**.\n` +
                "Bạn không có hành động trong lượt này."
            );
        }

        /*
        ========================================================
        WOLF
        ========================================================
        */

        if (action === "wolf") {
            if (
                session.phase !== "night" ||
                session.nightStep !== "wolf"
            ) {
                return privateAction(
                    interaction,
                    "Hiện tại chưa đến lượt Sói."
                );
            }

            const playerId =
                interaction.user.id;

            if (getRole(playerId) !== "wolf") {
                return privateAction(
                    interaction,
                    "Bạn không phải Sói."
                );
            }

            if (!isAlive(playerId)) {
                return privateAction(
                    interaction,
                    "Bạn đã chết."
                );
            }

            const targetId = parts[3];

            if (!targetId || !isAlive(targetId)) {
                return privateAction(
                    interaction,
                    "Mục tiêu không hợp lệ."
                );
            }

            if (getRole(targetId) === "wolf") {
                return privateAction(
                    interaction,
                    "Sói không thể chọn Sói."
                );
            }

            session.nightActions.set(
                `wolf_${playerId}`,
                targetId
            );

            const wolves =
                getAliveRolePlayers("wolf");

            const allChosen =
                wolves.every(wolf =>
                    session.nightActions.has(
                        `wolf_${wolf.id}`
                    )
                );

            await privateAction(
                interaction,

                `🐺 Bạn đã chọn <@${targetId}>.\n` +
                (
                    allChosen
                        ? "Tất cả Sói đã chọn."
                        : "Đang chờ các Sói khác."
                )
            );

            if (!allChosen) {
                return;
            }

            /*
            Đếm phiếu Sói
            */

            const wolfVotes = new Map();

            for (const wolf of wolves) {
                const target =
                    session.nightActions.get(
                        `wolf_${wolf.id}`
                    );

                if (!target) continue;

                wolfVotes.set(
                    target,
                    (wolfVotes.get(target) || 0) + 1
                );
            }

            if (wolfVotes.size === 0) {
                return;
            }

            const maxVotes =
                Math.max(...wolfVotes.values());

            const winners =
                [...wolfVotes.entries()]
                    .filter(([id, votes]) =>
                        votes === maxVotes
                    )
                    .map(([id]) => id);

            const selected =
                winners[
                    Math.floor(
                        Math.random() *
                        winners.length
                    )
                ];

            session.nightActions.set(
                "wolf",
                selected
            );

            await startSeer();

            return;
        }

        /*
        ========================================================
        SEER
        ========================================================
        */

        if (action === "seer") {
            if (
                session.phase !== "night" ||
                session.nightStep !== "seer"
            ) {
                return privateAction(
                    interaction,
                    "Hiện tại chưa đến lượt Tiên Tri."
                );
            }

            if (getRole(interaction.user.id) !== "seer") {
                return privateAction(
                    interaction,
                    "Bạn không phải Tiên Tri."
                );
            }

            const targetId = parts[3];

            if (!targetId || !isAlive(targetId)) {
                return privateAction(
                    interaction,
                    "Mục tiêu không hợp lệ."
                );
            }

            if (targetId === interaction.user.id) {
                return privateAction(
                    interaction,
                    "Bạn không thể tự soi mình."
                );
            }

            const targetRole =
                getRole(targetId);

            await privateAction(
                interaction,

                `🔮 <@${targetId}> là **${
                    roleNames[targetRole] || targetRole
                }**.`
            );

            session.nightActions.set(
                "seer",
                targetId
            );

            await startGuardian();

            return;
        }

        /*
        ========================================================
        GUARDIAN
        ========================================================
        */

        if (action === "guardian") {
            if (
                session.phase !== "night" ||
                session.nightStep !== "guardian"
            ) {
                return privateAction(
                    interaction,
                    "Hiện tại chưa đến lượt Bảo Vệ."
                );
            }

            if (
                getRole(interaction.user.id) !==
                "guardian"
            ) {
                return privateAction(
                    interaction,
                    "Bạn không phải Bảo Vệ."
                );
            }

            const targetId = parts[3];

            if (!targetId || !isAlive(targetId)) {
                return privateAction(
                    interaction,
                    "Mục tiêu không hợp lệ."
                );
            }

            session.nightActions.set(
                "guardian",
                targetId
            );

            await privateAction(
                interaction,

                `🛡️ Bạn đã bảo vệ <@${targetId}>.`
            );

            await startWitch();

            return;
        }

        /*
        ========================================================
        WITCH HEAL
        ========================================================
        */

        if (action === "witchheal") {
            if (
                session.phase !== "night" ||
                session.nightStep !== "witch"
            ) {
                return privateAction(
                    interaction,
                    "Hiện tại chưa đến lượt Phù Thủy."
                );
            }

            if (
                getRole(interaction.user.id) !== "witch"
            ) {
                return privateAction(
                    interaction,
                    "Bạn không phải Phù Thủy."
                );
            }

            if (session.witchHealUsed) {
                return privateAction(
                    interaction,
                    "Bạn đã dùng thuốc cứu rồi."
                );
            }

            const target =
                session.nightActions.get("wolf");

            if (!target) {
                return privateAction(
                    interaction,
                    "Sói chưa chọn mục tiêu."
                );
            }

            session.witchHealUsed = true;

            session.nightActions.set(
                "witch_heal",
                target
            );

            await privateAction(
                interaction,

                `💚 Bạn đã cứu <@${target}>.\n` +
                "Bạn vẫn có thể dùng thuốc độc nếu muốn."
            );

            return;
        }

        /*
        ========================================================
        WITCH KILL
        ========================================================
        */

        if (action === "witchkill") {
            if (
                session.phase !== "night" ||
                session.nightStep !== "witch"
            ) {
                return privateAction(
                    interaction,
                    "Hiện tại chưa đến lượt Phù Thủy."
                );
            }

            if (
                getRole(interaction.user.id) !== "witch"
            ) {
                return privateAction(
                    interaction,
                    "Bạn không phải Phù Thủy."
                );
            }

            if (session.witchKillUsed) {
                return privateAction(
                    interaction,
                    "Bạn đã dùng thuốc độc rồi."
                );
            }

            const targetId = parts[3];

            if (!targetId || !isAlive(targetId)) {
                return privateAction(
                    interaction,
                    "Mục tiêu không hợp lệ."
                );
            }

            if (targetId === interaction.user.id) {
                return privateAction(
                    interaction,
                    "Bạn không thể dùng thuốc độc lên chính mình."
                );
            }

            session.witchKillUsed = true;

            session.nightActions.set(
                "witch_kill",
                targetId
            );

            await privateAction(
                interaction,

                `☠️ Bạn đã chọn giết <@${targetId}> bằng thuốc độc.`
            );

            return;
        }

        /*
        ========================================================
        WITCH SKIP
        ========================================================
        */

        if (action === "witchskip") {
            if (
                session.phase !== "night" ||
                session.nightStep !== "witch"
            ) {
                return privateAction(
                    interaction,
                    "Hiện tại chưa đến lượt Phù Thủy."
                );
            }

            if (
                getRole(interaction.user.id) !== "witch"
            ) {
                return privateAction(
                    interaction,
                    "Bạn không phải Phù Thủy."
                );
            }

            await privateAction(
                interaction,
                "🧪 Bạn đã bỏ qua lượt Phù Thủy."
            );

            await resolveNight();

            return;
        }

        /*
        ========================================================
        VOTE OPEN
        ========================================================
        */

        if (action === "voteopen") {
            return openVote(interaction);
        }

        /*
        ========================================================
        VOTE
        ========================================================
        */

        if (action === "vote") {
            if (session.phase !== "day") {
                return privateAction(
                    interaction,
                    "Hiện tại không phải thời gian bỏ phiếu."
                );
            }

            const voterId =
                interaction.user.id;

            if (!isAlive(voterId)) {
                return privateAction(
                    interaction,
                    "Bạn đã chết."
                );
            }

            if (
                session.voteResults.has(voterId)
            ) {
                return privateAction(
                    interaction,
                    "Bạn đã bỏ phiếu rồi."
                );
            }

            const targetId = parts[3];

            if (!targetId || !isAlive(targetId)) {
                return privateAction(
                    interaction,
                    "Mục tiêu không hợp lệ."
                );
            }

            if (targetId === voterId) {
                return privateAction(
                    interaction,
                    "Bạn không thể tự vote chính mình."
                );
            }

            session.voteResults.set(
                voterId,
                targetId
            );

            await privateAction(
                interaction,

                `🗳️ Bạn đã vote <@${targetId}>.`
            );

            const alive =
                getAlivePlayers();

            const allVoted =
                alive.every(player =>
                    session.voteResults.has(
                        player.id
                    )
                );

            if (allVoted) {
                await resolveVotes();
            }

            return;
        }

        /*
        ========================================================
        BLANK VOTE
        ========================================================
        */

        if (action === "blank") {
            if (session.phase !== "day") {
                return privateAction(
                    interaction,
                    "Hiện tại không phải thời gian bỏ phiếu."
                );
            }

            const voterId =
                interaction.user.id;

            if (!isAlive(voterId)) {
                return privateAction(
                    interaction,
                    "Bạn đã chết."
                );
            }

            if (
                session.voteResults.has(voterId)
            ) {
                return privateAction(
                    interaction,
                    "Bạn đã bỏ phiếu rồi."
                );
            }

            session.voteResults.set(
                voterId,
                null
            );

            await privateAction(
                interaction,
                "🗳️ Bạn đã bỏ **phiếu trắng**."
            );

            const alive =
                getAlivePlayers();

            const allVoted =
                alive.every(player =>
                    session.voteResults.has(
                        player.id
                    )
                );

            if (allVoted) {
                await resolveVotes();
            }

            return;
        }
    };

    /*
    ============================================================
    REGISTER HANDLER
    ============================================================
    */

    session.buttonHandler = buttonHandler;

    client.on(
        "interactionCreate",
        buttonHandler
    );

    /*
    ============================================================
    START LOBBY
    ============================================================
    */

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
