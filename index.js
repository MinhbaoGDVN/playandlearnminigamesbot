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
    ButtonStyle,
    MessageFlags,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
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
    "1064137649725653127",
    "1531573398692565002"
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
    SESSION RESET
    ============================================================
    */

    session.phase = "lobby";

    session.players = new Map();
    session.roles = new Map();
    session.alivePlayers = new Set();

    session.night = 0;
    session.day = 0;

    /*
        playerId => {
            actions: [
                {
                    type: "kill",
                    target: "123"
                }
            ]
        }
    */

    session.nightActions = new Map();

    /*
        playerId => targetId | null
    */

    session.voteResults = new Map();

    session.witchHealUsed = false;
    session.witchKillUsed = false;

    session.lobbyMessage = null;
    session.nightMessage = null;

    session.nightTimer = null;
    session.nightDuration = 60_000;

    session.voteOpen = false;

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


    const getAliveByRole = role => {
        return getAlivePlayers()
            .filter(player => getRole(player.id) === role);
    };


    const getPlayerName = id => {
        const player = getPlayer(id);

        return player
            ? player.username
            : "Không xác định";
    };


    const replyPrivate = async (interaction, data) => {

        return interaction.reply({
            ...data,
            flags: MessageFlags.Ephemeral
        });

    };


    /*
    ============================================================
    PRIVATE ROLE INFO
    ============================================================
    */

    const sendRoleInfo = async playerId => {

        const player = getPlayer(playerId);

        if (!player) return;

        const role = getRole(playerId);

        await channel.send({
            content:
                `Vai trò của <@${playerId}> đã được gửi riêng.`
        });

        /*
            Không gửi role vào server public.
            Role được lấy khi người chơi nhấn "Hành động".
        */
    };


    /*
    ============================================================
    TARGET SELECT MENU
    ============================================================
    */

    const createTargetMenu = (
        action,
        playerId,
        targets,
        placeholder = "Chọn mục tiêu..."
    ) => {

        const options = targets
            .slice(0, 25)
            .map(player => ({
                label: player.username.slice(0, 100),
                value: player.id
            }));


        if (!options.length) {
            return [];
        }


        const menu =
            new StringSelectMenuBuilder()
                .setCustomId(
                    `masoi_target_${session.guildId}_${action}_${playerId}`
                )
                .setPlaceholder(placeholder)
                .addOptions(options);


        return [
            new ActionRowBuilder()
                .addComponents(menu)
        ];
    };


    /*
    ============================================================
    GET PLAYER ACTIONS
    ============================================================
    */

    const getActions = playerId => {

        return session.nightActions.get(playerId) || [];

    };


    const setSingleAction = (
        playerId,
        type,
        target
    ) => {

        session.nightActions.set(
            playerId,
            [
                {
                    type,
                    target
                }
            ]
        );

    };


    const addAction = (
        playerId,
        type,
        target
    ) => {

        const actions = getActions(playerId);

        const index =
            actions.findIndex(
                action => action.type === type
            );


        const newAction = {
            type,
            target
        };


        if (index !== -1) {
            actions[index] = newAction;
        } else {
            actions.push(newAction);
        }


        session.nightActions.set(
            playerId,
            actions
        );

    };


    const removeAction = (
        playerId,
        type
    ) => {

        const actions =
            getActions(playerId)
                .filter(action =>
                    action.type !== type
                );


        session.nightActions.set(
            playerId,
            actions
        );

    };


    const getAction = (
        playerId,
        type
    ) => {

        return getActions(playerId)
            .find(action =>
                action.type === type
            );

    };


    /*
    ============================================================
    ACTION MENU
    ============================================================
    */

    const showActionMenu = async interaction => {

        const playerId = interaction.user.id;


        if (session.phase !== "night") {

            return replyPrivate(interaction, {
                content:
                    "Hiện tại không phải buổi đêm."
            });

        }


        if (!session.players.has(playerId)) {

            return replyPrivate(interaction, {
                content:
                    "Bạn không tham gia ván này."
            });

        }


        if (!isAlive(playerId)) {

            return replyPrivate(interaction, {
                content:
                    "Bạn đã chết và không thể hành động."
            });

        }


        const role = getRole(playerId);

        const actions =
            getActions(playerId);


        /*
        ========================================================
        WOLF
        ========================================================
        */

        if (role === "wolf") {

            const current =
                getAction(playerId, "kill");


            const targets =
                getAlivePlayers()
                    .filter(player =>
                        getRole(player.id) !== "wolf"
                    );


            const rows = [];


            rows.push(
                new ActionRowBuilder()
                    .addComponents(

                        new ButtonBuilder()
                            .setCustomId(
                                `masoi_choose_${session.guildId}_kill`
                            )
                            .setLabel(
                                "Chọn người để giết"
                            )
                            .setStyle(
                                ButtonStyle.Danger
                            ),

                        new ButtonBuilder()
                            .setCustomId(
                                `masoi_clear_${session.guildId}_kill`
                            )
                            .setLabel(
                                "Hủy hành động"
                            )
                            .setStyle(
                                ButtonStyle.Secondary
                            )

                    )
            );


            let text =
                "**Bạn là Sói**\n\n" +
                "Bạn có thể chọn mục tiêu giết.\n";


            if (current) {

                text +=
                    `\n**Đang chọn:** <@${current.target}>`;

            } else {

                text +=
                    "\n**Hiện tại:** Chưa chọn.";

            }


            return replyPrivate(interaction, {
                content: text,
                components: rows
            });

        }


        /*
        ========================================================
        SEER
        ========================================================
        */

if (role === "seer") {
    const current =
        getAction(playerId, "seer");

    const lastResult =
        session.seerResults?.get(playerId);

    const targets =
        getAlivePlayers()
            .filter(player =>
                player.id !== playerId
            );

    let text =
        "🔮 **Bạn là Tiên Tri**\n\n" +
        "Bạn có thể soi một người.\n";

    if (current) {
        text +=
            `\n**Đang soi:** <@${current.target}>`;
    } else {
        text +=
            "\n**Hiện tại:** Chưa chọn.";
    }

    if (lastResult) {
        text +=
            `\n\n🔮 **Kết quả soi gần nhất:**\n` +
            `<@${lastResult.target}> là **${roleNames[lastResult.role]}**.`;
    }

    return replyPrivate(
        interaction,
        {
            content: text,
            components: [
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(
                                `masoi_choose_${session.guildId}_seer`
                            )
                            .setLabel(
                                "Chọn người để soi"
                            )
                            .setStyle(
                                ButtonStyle.Primary
                            ),

                        new ButtonBuilder()
                            .setCustomId(
                                `masoi_clear_${session.guildId}_seer`
                            )
                            .setLabel(
                                "Hủy"
                            )
                            .setStyle(
                                ButtonStyle.Secondary
                            )
                    )
            ]
        }
    );
}


        /*
        ========================================================
        GUARDIAN
        ========================================================
        */

        if (role === "guardian") {

            const current =
                getAction(playerId, "protect");


            const targets =
                getAlivePlayers();


            let text =
                "**Bạn là Bảo Vệ**\n\n" +
                "Bạn có thể bảo vệ một người.\n";


            if (current) {

                text +=
                    `\n**Đang bảo vệ:** <@${current.target}>`;

            } else {

                text +=
                    "\n**Hiện tại:** Chưa chọn.";

            }


            return replyPrivate(interaction, {
                content: text,
                components: [
                    new ActionRowBuilder()
                        .addComponents(

                            new ButtonBuilder()
                                .setCustomId(
                                    `masoi_choose_${session.guildId}_protect`
                                )
                                .setLabel(
                                    "Chọn người bảo vệ"
                                )
                                .setStyle(
                                    ButtonStyle.Success
                                ),

                            new ButtonBuilder()
                                .setCustomId(
                                    `masoi_clear_${session.guildId}_protect`
                                )
                                .setLabel(
                                    "Hủy"
                                )
                                .setStyle(
                                    ButtonStyle.Secondary
                                )

                        )
                ]
            });

        }


        /*
        ========================================================
        WITCH
        ========================================================
        */

        if (role === "witch") {

            const rows = [];


            const heal =
                getAction(playerId, "heal");

            const poison =
                getAction(playerId, "poison");


            rows.push(
                new ActionRowBuilder()
                    .addComponents(

                        new ButtonBuilder()
                            .setCustomId(
                                `masoi_choose_${session.guildId}_heal`
                            )
                            .setLabel(
                                session.witchHealUsed
                                    ? "Thuốc cứu đã dùng"
                                    : "Dùng thuốc cứu"
                            )
                            .setStyle(
                                ButtonStyle.Success
                            )
                            .setDisabled(
                                session.witchHealUsed
                            ),

                        new ButtonBuilder()
                            .setCustomId(
                                `masoi_choose_${session.guildId}_poison`
                            )
                            .setLabel(
                                session.witchKillUsed
                                    ? "Thuốc độc đã dùng"
                                    : "Dùng thuốc độc"
                            )
                            .setStyle(
                                ButtonStyle.Danger
                            )
                            .setDisabled(
                                session.witchKillUsed
                            )

                    )
            );


            let text =
                "**Bạn là Phù Thủy**\n\n";


            if (heal) {

                text +=
                    `**Thuốc cứu:** <@${heal.target}>\n`;

            } else {

                text +=
                    "**Thuốc cứu:** Không dùng\n";

            }


            if (poison) {

                text +=
                    `**Thuốc độc:** <@${poison.target}>\n`;

            } else {

                text +=
                    "**Thuốc độc:** Không dùng\n";

            }


            text +=
                "\nBạn có thể dùng cả hai loại thuốc trong cùng một đêm.";


            return replyPrivate(interaction, {
                content: text,
                components: rows
            });

        }


        /*
        ========================================================
        HUNTER
        ========================================================
        */

        if (role === "hunter") {

            return replyPrivate(interaction, {
                content:
                    "**Bạn là Thợ Săn**\n\n" +
                    "Hiện tại bạn chưa có hành động trong đêm."
            });

        }


        /*
        ========================================================
        VILLAGER
        ========================================================
        */

        return replyPrivate(interaction, {
            content:
                "**Bạn là Dân Làng**\n\n" +
                "Bạn không có kỹ năng đặc biệt trong đêm.\n" +
                "Hãy chờ đến buổi sáng."
        });

    };


    /*
    ============================================================
    CHOOSE ACTION
    ============================================================
    */

    const chooseAction = async (
        interaction,
        action
    ) => {

        const playerId =
            interaction.user.id;


        if (session.phase !== "night") {

            return replyPrivate(interaction, {
                content:
                    "Đêm đã kết thúc."
            });

        }


        if (!isAlive(playerId)) {

            return replyPrivate(interaction, {
                content:
                    "Bạn đã chết."
            });

        }


        const role =
            getRole(playerId);


        const allowed = {

            wolf: ["kill"],
            seer: ["seer"],
            guardian: ["protect"],
            witch: ["heal", "poison"]

        };


        if (!allowed[role]?.includes(action)) {

            return replyPrivate(interaction, {
                content:
                    "Bạn không thể sử dụng hành động này."
            });

        }


        /*
        ========================================================
        WITCH HEAL
        ========================================================
        */

        if (
            action === "heal" &&
            session.witchHealUsed
        ) {

            return replyPrivate(interaction, {
                content:
                    "Bạn đã dùng thuốc cứu."
            });

        }


        /*
        ========================================================
        WITCH POISON
        ========================================================
        */

        if (
            action === "poison" &&
            session.witchKillUsed
        ) {

            return replyPrivate(interaction, {
                content:
                    "Bạn đã dùng thuốc độc."
            });

        }


        /*
        ========================================================
        GET TARGETS
        ========================================================
        */

        let targets =
            getAlivePlayers();


        if (action === "kill") {

            targets =
                targets.filter(player =>
                    getRole(player.id) !== "wolf"
                );

        }


        if (
            action === "seer" ||
            action === "poison"
        ) {

            targets =
                targets.filter(player =>
                    player.id !== playerId
                );

        }


        /*
        ========================================================
        WITCH HEAL
        ========================================================
        */

        if (action === "heal") {

            const wolfTarget =
                getWolfTarget();


            if (!wolfTarget) {

                return replyPrivate(interaction, {
                    content:
                        "Hiện tại chưa có mục tiêu Sói để cứu."
                });

            }


            setSingleAction(
                playerId,
                "heal",
                wolfTarget
            );


            session.witchHealUsed = true;


            return replyPrivate(interaction, {
                content:
                    `Bạn đã chọn cứu <@${wolfTarget}>.\n\n` +
                    "Hành động đã được lưu."
            });

        }


        /*
        ========================================================
        NORMAL TARGET
        ========================================================
        */

        return replyPrivate(interaction, {
            content:
                `Chọn mục tiêu cho hành động **${action}**:`,

            components:
                createTargetMenu(
                    action,
                    playerId,
                    targets
                )
        });

    };


    /*
    ============================================================
    WOLF TARGET
    ============================================================
    */

    const getWolfTarget = () => {

        const votes = new Map();


        for (
            const player of getAliveByRole("wolf")
        ) {

            const action =
                getAction(
                    player.id,
                    "kill"
                );


            if (!action) continue;


            votes.set(
                action.target,
                (votes.get(action.target) || 0) + 1
            );

        }


        if (!votes.size) {
            return null;
        }


        const max =
            Math.max(...votes.values());


        const winners =
            [...votes.entries()]
                .filter(
                    ([, count]) =>
                        count === max
                )
                .map(
                    ([id]) => id
                );


        return winners[
            Math.floor(
                Math.random() * winners.length
            )
        ];

    };


    /*
    ============================================================
    NIGHT RESOLVER
    ============================================================
    */

    const resolveNight = async () => {

        if (session.phase !== "night") {
            return;
        }


        session.phase = "resolving";


        if (session.nightTimer) {

            clearTimeout(
                session.nightTimer
            );

            session.nightTimer = null;

        }


        const deaths = new Set();


        /*
        ========================================================
        1. TÍNH MỤC TIÊU SÓI
        ========================================================
        */

        const wolfTarget =
            getWolfTarget();


        /*
        ========================================================
        2. TÍNH BẢO VỆ
        ========================================================
        */

        const guardian =
            getAliveByRole("guardian")[0];


        let protectedTarget = null;


        if (guardian) {

            const action =
                getAction(
                    guardian.id,
                    "protect"
                );


            if (action) {

                protectedTarget =
                    action.target;

            }

        }


        /*
        ========================================================
        3. TÍNH THUỐC CỨU
        ========================================================
        */

        const witch =
            getAliveByRole("witch")[0];


        let healTarget = null;
        let poisonTarget = null;


        if (witch) {

            const heal =
                getAction(
                    witch.id,
                    "heal"
                );


            const poison =
                getAction(
                    witch.id,
                    "poison"
                );


            if (heal) {
                healTarget = heal.target;
            }


            if (poison) {
                poisonTarget = poison.target;
            }

        }


        /*
        ========================================================
        4. SÁT THƯƠNG SÓI
        ========================================================
        */

        if (
            wolfTarget &&
            isAlive(wolfTarget) &&
            wolfTarget !== protectedTarget &&
            wolfTarget !== healTarget
        ) {

            deaths.add(
                wolfTarget
            );

        }


        /*
        ========================================================
        5. THUỐC ĐỘC
        ========================================================
        */

        if (
            poisonTarget &&
            isAlive(poisonTarget)
        ) {

            deaths.add(
                poisonTarget
            );

        }


        /*
        ========================================================
        6. THÔNG BÁO CHẾT
        ========================================================
        */

        for (
            const playerId of deaths
        ) {

            session.alivePlayers.delete(
                playerId
            );

        }


        /*
        ========================================================
        7. KẾT QUẢ SOI
        ========================================================
        */

        const seer =
            getAliveByRole("seer")[0];


        let seerResult = null;


        if (seer) {

            const action =
                getAction(
                    seer.id,
                    "seer"
                );


            if (action && isAlive(action.target)) {

                seerResult = {
                    seer: seer.id,
                    target: action.target,
                    role: getRole(action.target)
                };

            }

        }


        /*
        ========================================================
        8. MORNING EVENT
        ========================================================
        */

        session.phase = "morning";


        let morningText =
            `**Buổi sáng ${session.day + 1}**\n\n`;


        if (!deaths.size) {

            morningText +=
                "Đêm qua không có ai chết.";

        } else {

            morningText +=
                [...deaths]
                    .map(id =>
                        `<@${id}>`
                    )
                    .join(", ") +
                " đã chết trong đêm.";

        }


        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        `Buổi sáng ${session.day + 1}`
                    )
                    .setDescription(
                        morningText
                    )
            ]
        });


        /*
        ========================================================
        9. GỬI KẾT QUẢ SOI RIÊNG
        ========================================================
        */

        if (seerResult) {

            /*
                Không gửi kết quả soi ra channel.
                Tìm cách gửi bằng interaction không phù hợp
                vì interaction đã kết thúc.

                Vì vậy lưu kết quả để lần sau Tiên Tri
                nhấn Hành động sẽ xem được.
            */

            session.seerResults ??=
                new Map();


            session.seerResults.set(
                seerResult.seer,
                seerResult
            );

        }


        /*
        ========================================================
        10. CHECK WIN
        ========================================================
        */

        if (
            await checkWin()
        ) {

            return;

        }


        /*
        ========================================================
        11. START DAY
        ========================================================
        */

        await startDay();

    };


    /*
    ============================================================
    CHECK WIN
    ============================================================
    */

    const checkWin = async () => {
        const alive = getAlivePlayers();
    
        const wolves = alive.filter(
            player => getRole(player.id) === "wolf"
        );
    
        const villagers = alive.filter(
            player => getRole(player.id) !== "wolf"
        );
    
        // Không còn Sói
        if (wolves.length === 0) {
            session.phase = "ended";
    
            await channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Dân Làng thắng!")
                        .setDescription(
                            "Tất cả Sói đã bị loại."
                        )
                ]
            });
    
            cleanup();
            return true;
        }
    
        // Chỉ còn 1 người không phải Sói
        if (villagers.length === 1) {
            session.phase = "ended";
    
            await channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Sói thắng!")
                        .setDescription(
                            "Phe Dân chỉ còn 1 người sống."
                        )
                ]
            });
    
            cleanup();
            return true;
        }
    
        return false;
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


        /*
        Reset các action dùng một lần
        không reset thuốc.
        */


        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        `Đêm ${session.night}`
                    )
                    .setDescription(
                        "Đêm đã bắt đầu.\n\n" +
                        "Người chơi có kỹ năng hãy nhấn **Hành động** để thực hiện lựa chọn.\n\n" +
                        "Bạn có thể thay đổi lựa chọn trước khi đêm kết thúc."
                    )
            ],
            components: [
                new ActionRowBuilder()
                    .addComponents(

                        new ButtonBuilder()
                            .setCustomId(
                                `masoi_action_${session.guildId}`
                            )
                            .setLabel(
                                "Hành động"
                            )
                            .setStyle(
                                ButtonStyle.Primary
                            )

                    )
            ]
        });


        /*
        ========================================================
        NIGHT TIMER
        ========================================================
        */

        session.nightTimer =
            setTimeout(
                async () => {

                    if (
                        session.phase === "night"
                    ) {

                        await resolveNight();

                    }

                },
                session.nightDuration
            );

    };


    /*
    ============================================================
    START DAY
    ============================================================
    */

    const startDay = async () => {

        session.phase = "day";

        session.day++;

        session.voteResults.clear();

        session.voteOpen = true;


        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        `Ngày ${session.day}`
                    )
                    .setDescription(
                        "Mọi người có thể thảo luận.\n\n" +
                        "Khi muốn bỏ phiếu, hãy nhấn nút bên dưới."
                    )
            ],
            components: [
                new ActionRowBuilder()
                    .addComponents(

                        new ButtonBuilder()
                            .setCustomId(
                                `masoi_voteopen_${session.guildId}`
                            )
                            .setLabel(
                                "Bỏ phiếu"
                            )
                            .setStyle(
                                ButtonStyle.Primary
                            )

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

        if (
            session.phase !== "day" ||
            !session.voteOpen
        ) {

            return replyPrivate(interaction, {
                content:
                    "Hiện tại chưa thể bỏ phiếu."
            });

        }


        const playerId =
            interaction.user.id;


        if (!isAlive(playerId)) {

            return replyPrivate(interaction, {
                content:
                    "Bạn đã chết."
            });

        }


        const targets =
            getAlivePlayers()
                .filter(
                    player =>
                        player.id !== playerId
                );


        const menu =
            new StringSelectMenuBuilder()
                .setCustomId(
                    `masoi_vote_${session.guildId}_${playerId}`
                )
                .setPlaceholder(
                    "Chọn người để bỏ phiếu..."
                )
                .addOptions(
                    targets
                        .slice(0, 25)
                        .map(player => ({
                            label:
                                player.username.slice(0, 100),
                            value:
                                player.id
                        }))
                );


        return replyPrivate(interaction, {

            content:
                "**Bỏ phiếu**\n\n" +
                "Bạn có thể chọn một người hoặc bỏ phiếu trắng.",

            components: [

                new ActionRowBuilder()
                    .addComponents(menu),

                new ActionRowBuilder()
                    .addComponents(

                        new ButtonBuilder()
                            .setCustomId(
                                `masoi_blank_${session.guildId}`
                            )
                            .setLabel(
                                "Phiếu trắng"
                            )
                            .setStyle(
                                ButtonStyle.Secondary
                            )

                    )

            ]

        });

    };


    /*
    ============================================================
    RESOLVE VOTES
    ============================================================
    */

    const resolveVotes = async () => {

        session.voteOpen = false;

        const counts = new Map();


        for (
            const targetId of
            session.voteResults.values()
        ) {

            if (!targetId) continue;


            counts.set(
                targetId,
                (counts.get(targetId) || 0) + 1
            );

        }


        if (!counts.size) {

            await channel.send(
                "**Kết quả:** Không ai bị loại vì tất cả phiếu đều là phiếu trắng."
            );


            if (
                await checkWin()
            ) {
                return;
            }


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
                    ([, votes]) =>
                        votes === maxVotes
                )
                .map(
                    ([id]) => id
                );


        /*
        Hòa phiếu
        */

        if (
            winners.length !== 1
        ) {

            await channel.send(
                `**Kết quả:** Hòa phiếu giữa ${winners
                    .map(id => `<@${id}>`)
                    .join(", ")}.\n` +
                "Không ai bị loại."
            );


            await startNight();

            return;

        }


        const eliminated =
            winners[0];


        const role =
            getRole(eliminated);


        session.alivePlayers.delete(
            eliminated
        );


        await channel.send(
            `<@${eliminated}> đã bị treo cổ.\n` +
            `Vai trò: **${roleNames[role]}**.`
        );


        if (
            await checkWin()
        ) {
            return;
        }


        await startNight();

    };


    /*
    ============================================================
    ASSIGN ROLES
    ============================================================
    */

    const assignRoles = () => {

        const players =
            [...session.players.values()];


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

            const wolfCount =
                Math.max(
                    2,
                    Math.floor(players.length / 3)
                );


            roles = [
                ...Array(
                    wolfCount
                ).fill("wolf"),

                "seer",
                "guardian",
                "witch",
                "hunter"
            ];


            while (
                roles.length <
                players.length
            ) {

                roles.push(
                    "villager"
                );

            }


            roles =
                roles.slice(
                    0,
                    players.length
                );

        }


        /*
        Shuffle Fisher-Yates
        */

        for (
            let i = roles.length - 1;
            i > 0;
            i--
        ) {

            const j =
                Math.floor(
                    Math.random() * (i + 1)
                );


            [
                roles[i],
                roles[j]
            ] = [
                roles[j],
                roles[i]
            ];

        }


        players.forEach(
            (player, index) => {

                session.roles.set(
                    player.id,
                    roles[index]
                );


                session.alivePlayers.add(
                    player.id
                );

            }
        );

    };


    /*
    ============================================================
    BUTTON / SELECT HANDLER
    ============================================================
    */

    const buttonHandler =
        async interaction => {

            if (
                !interaction.isButton() &&
                !interaction.isStringSelectMenu()
            ) {
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


            if (
                parts[0] !== "masoi"
            ) {
                return;
            }


            const action =
                parts[1];


            /*
            ====================================================
            ACTION BUTTON
            ====================================================
            */

            if (
                action === "action"
            ) {

                return showActionMenu(
                    interaction
                );

            }


            /*
            ====================================================
            CHOOSE ACTION
            ====================================================
            */

            if (
                action === "choose"
            ) {

                const selectedAction =
                    parts[3];


                return chooseAction(
                    interaction,
                    selectedAction
                );

            }


            /*
            ====================================================
            TARGET SELECT
            ====================================================
            */

            if (
                action === "target"
            ) {

                if (
                    session.phase !== "night"
                ) {

                    return replyPrivate(
                        interaction,
                        {
                            content:
                                "Đêm đã kết thúc."
                        }
                    );

                }


                const selectedAction =
                    parts[3];


                const playerId =
                    parts[4];


                if (
                    interaction.user.id !==
                    playerId
                ) {

                    return replyPrivate(
                        interaction,
                        {
                            content:
                                "Menu này không thuộc về bạn."
                        }
                    );

                }


                const targetId =
                    interaction.values[0];


                if (
                    !isAlive(targetId)
                ) {

                    return replyPrivate(
                        interaction,
                        {
                            content:
                                "Người này đã chết."
                        }
                    );

                }


                /*
                ================================
                WOLF
                ================================
                */

                if (
                    selectedAction === "kill"
                ) {

                    if (
                        getRole(playerId) !==
                        "wolf"
                    ) {

                        return replyPrivate(
                            interaction,
                            {
                                content:
                                    "Bạn không phải Sói."
                            }
                        );

                    }


                    if (
                        getRole(targetId) ===
                        "wolf"
                    ) {

                        return replyPrivate(
                            interaction,
                            {
                                content:
                                    "Không thể giết Sói."
                            }
                        );

                    }


                    setSingleAction(
                        playerId,
                        "kill",
                        targetId
                    );

                }


                /*
                ================================
                SEER
                ================================
                */

                else if (
                    selectedAction === "seer"
                ) {
                    setSingleAction(
                        playerId,
                        "seer",
                        targetId
                    );
                
                    const targetRole = getRole(targetId);
                
                    // Lưu kết quả để Tiên Tri vẫn có thể xem lại
                    session.seerResults ??= new Map();
                
                    session.seerResults.set(
                        playerId,
                        {
                            seer: playerId,
                            target: targetId,
                            role: targetRole
                        }
                    );
                
                    return replyPrivate(
                        interaction,
                        {
                            content:
                                `🔮 **Kết quả soi**\n\n` +
                                `<@${targetId}> là **${roleNames[targetRole]}**.\n\n` +
                                `Hành động soi đã được lưu.`
                        }
                    );
                }


                /*
                ================================
                GUARDIAN
                ================================
                */

                else if (
                    selectedAction === "protect"
                ) {

                    setSingleAction(
                        playerId,
                        "protect",
                        targetId
                    );

                }


                /*
                ================================
                WITCH POISON
                ================================
                */

                else if (
                    selectedAction === "poison"
                ) {

                    if (
                        session.witchKillUsed
                    ) {

                        return replyPrivate(
                            interaction,
                            {
                                content:
                                    "Bạn đã dùng thuốc độc."
                            }
                        );

                    }


                    addAction(
                        playerId,
                        "poison",
                        targetId
                    );


                    session.witchKillUsed =
                        true;

                }


                await interaction.update({
                    content:
                        `Đã lưu hành động **${selectedAction}** lên <@${targetId}>.\n\n` +
                        "Bạn có thể nhấn **Hành động** lần nữa để thay đổi lựa chọn.",
                    components: []
                });


                return;

            }


            /*
            ====================================================
            CLEAR ACTION
            ====================================================
            */

            if (
                action === "clear"
            ) {

                const actionType =
                    parts[3];


                const playerId =
                    interaction.user.id;


                if (
                    actionType === "heal"
                ) {

                    removeAction(
                        playerId,
                        "heal"
                    );

                    session.witchHealUsed =
                        false;

                }

                else if (
                    actionType === "poison"
                ) {

                    removeAction(
                        playerId,
                        "poison"
                    );

                    session.witchKillUsed =
                        false;

                }

                else {

                    removeAction(
                        playerId,
                        actionType
                    );

                }


                return replyPrivate(
                    interaction,
                    {
                        content:
                            "Đã hủy hành động."
                    }
                );

            }


            /*
            ====================================================
            VOTE OPEN
            ====================================================
            */

            if (
                action === "voteopen"
            ) {

                return openVote(
                    interaction
                );

            }


            /*
            ====================================================
            VOTE SELECT
            ====================================================
            */

            if (
                action === "vote"
            ) {

                if (
                    session.phase !== "day"
                ) {

                    return replyPrivate(
                        interaction,
                        {
                            content:
                                "Hiện tại không phải thời gian bỏ phiếu."
                        }
                    );

                }


                const playerId =
                    interaction.user.id;


                if (
                    !isAlive(playerId)
                ) {

                    return replyPrivate(
                        interaction,
                        {
                            content:
                                "Bạn đã chết."
                        }
                    );

                }


                const targetId =
                    interaction.values[0];


                if (
                    !isAlive(targetId)
                ) {

                    return replyPrivate(
                        interaction,
                        {
                            content:
                                "Người này đã chết."
                        }
                    );

                }


                session.voteResults.set(
                    playerId,
                    targetId
                );


                await interaction.update({
                    content:
                        `Bạn đã bỏ phiếu cho <@${targetId}>.`,
                    components: []
                });


                const alive =
                    getAlivePlayers();


                if (
                    alive.every(
                        player =>
                            session.voteResults.has(
                                player.id
                            )
                    )
                ) {

                    await resolveVotes();

                }


                return;

            }


            /*
            ====================================================
            BLANK VOTE
            ====================================================
            */

            if (
                action === "blank"
            ) {

                if (
                    session.phase !== "day"
                ) {

                    return replyPrivate(
                        interaction,
                        {
                            content:
                                "Hiện tại không phải thời gian bỏ phiếu."
                        }
                    );

                }


                const playerId =
                    interaction.user.id;


                if (
                    !isAlive(playerId)
                ) {

                    return replyPrivate(
                        interaction,
                        {
                            content:
                                "Bạn đã chết."
                        }
                    );

                }


                session.voteResults.set(
                    playerId,
                    null
                );


                await replyPrivate(
                    interaction,
                    {
                        content:
                            "Bạn đã bỏ **phiếu trắng**."
                    }
                );


                const alive =
                    getAlivePlayers();


                if (
                    alive.every(
                        player =>
                            session.voteResults.has(
                                player.id
                            )
                    )
                ) {

                    await resolveVotes();

                }


                return;

            }


            /*
            ====================================================
            BEGIN
            ====================================================
            */

            if (
                action === "begin"
            ) {

                if (
                    interaction.user.id !==
                    session.gameMasterId
                ) {

                    return replyPrivate(
                        interaction,
                        {
                            content:
                                "Chỉ Game Master mới có thể bắt đầu."
                        }
                    );

                }


                if (
                    session.players.size < 3
                ) {

                    return replyPrivate(
                        interaction,
                        {
                            content:
                                "Cần ít nhất 3 người chơi."
                        }
                    );

                }


                session.phase =
                    "starting";


                await interaction.update({
                    components: []
                });


                assignRoles();


                await channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(
                                "Ma Sói bắt đầu!"
                            )
                            .setDescription(
                                `Có **${session.players.size} người chơi**.\n\n` +
                                "Vai trò đã được phân phối riêng cho từng người."
                            )
                    ]
                });


                /*
                Không gửi role vào channel.
                */

                for (
                    const player of
                    session.players.values()
                ) {

                    await sendRoleInfo(
                        player.id
                    );

                }


                await startNight();


                return;

            }


            /*
            ====================================================
            JOIN
            ====================================================
            */

            if (
                action === "join"
            ) {

                if (
                    session.phase !== "lobby"
                ) {

                    return replyPrivate(
                        interaction,
                        {
                            content:
                                "Lobby đã đóng."
                        }
                    );

                }


                if (
                    session.players.has(
                        interaction.user.id
                    )
                ) {

                    return replyPrivate(
                        interaction,
                        {
                            content:
                                "Bạn đã tham gia."
                        }
                    );

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


                await replyPrivate(
                    interaction,
                    {
                        content:
                            "Bạn đã tham gia Ma Sói."
                    }
                );


                await updateLobby();


                return;

            }


            /*
            ====================================================
            LEAVE
            ====================================================
            */

            if (
                action === "leave"
            ) {

                if (
                    session.phase !== "lobby"
                ) {

                    return replyPrivate(
                        interaction,
                        {
                            content:
                                "Lobby đã đóng."
                        }
                    );

                }


                session.players.delete(
                    interaction.user.id
                );


                await replyPrivate(
                    interaction,
                    {
                        content:
                            "Bạn đã rời Ma Sói."
                    }
                );


                await updateLobby();


                return;

            }

        };


    /*
    ============================================================
    UPDATE LOBBY
    ============================================================
    */

    const updateLobby = async () => {

        const players =
            [...session.players.values()];


        const list =
            players.length

                ? players
                    .map(
                        (player, index) =>
                            `${index + 1}. <@${player.id}>`
                    )
                    .join("\n")

                : "Chưa có người chơi.";


        const embed =
            new EmbedBuilder()
                .setTitle(
                    "Ma Sói"
                )
                .setDescription(
                    `**Game Master:** <@${session.gameMasterId}>\n\n` +
                    `**Người chơi (${players.length}):**\n` +
                    `${list}\n\n` +
                    `Cần ít nhất **3 người** để bắt đầu.\n` +
                    `@here`
                );


        const buttons = [

            new ButtonBuilder()
                .setCustomId(
                    `masoi_join_${session.guildId}`
                )
                .setLabel(
                    "Tham gia"
                )
                .setStyle(
                    ButtonStyle.Success
                ),

            new ButtonBuilder()
                .setCustomId(
                    `masoi_leave_${session.guildId}`
                )
                .setLabel(
                    "Rời game"
                )
                .setStyle(
                    ButtonStyle.Secondary
                )

        ];


        if (
            players.length >= 3
        ) {

            buttons.push(

                new ButtonBuilder()
                    .setCustomId(
                        `masoi_begin_${session.guildId}`
                    )
                    .setLabel(
                        "Bắt đầu"
                    )
                    .setStyle(
                        ButtonStyle.Primary
                    )

            );

        }


        const row =
            new ActionRowBuilder()
                .addComponents(
                    buttons
                );


        if (
            session.lobbyMessage
        ) {

            await session.lobbyMessage
                .edit({
                    embeds: [embed],
                    components: [row]
                })
                .catch(() => {});


        } else {

            session.lobbyMessage =
                await channel.send({
                    embeds: [embed],
                    components: [row]
                });

        }

    };


    /*
    ============================================================
    CLEANUP
    ============================================================
    */

    const cleanup = () => {

        if (
            session.nightTimer
        ) {

            clearTimeout(
                session.nightTimer
            );

            session.nightTimer = null;

        }


        if (
            session.buttonHandler
        ) {

            client.off(
                "interactionCreate",
                session.buttonHandler
            );

            session.buttonHandler =
                null;

        }

    };


    /*
    ============================================================
    REGISTER HANDLER
    ============================================================
    */

    session.buttonHandler =
        buttonHandler;


    client.on(
        "interactionCreate",
        buttonHandler
    );


    /*
    ============================================================
    START
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
