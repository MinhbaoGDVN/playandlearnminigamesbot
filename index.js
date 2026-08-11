require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    PermissionFlagsBits,
    ChannelType
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
        .setName("backup")
        .setDescription("Lưu tạm trạng thái các game đang chạy")
];

async function initDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS game_backups (
            guild_id TEXT NOT NULL,
            game TEXT NOT NULL,
            state JSONB NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
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

async function startGame(game, guildId, channelId) {
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

    currentNumber: 0,
    lastUserId: null
};

    activeGames.set(key, session);

    gameFunction(session).catch(error => {
        console.error(`Game ${game} crashed:`, error);
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

async function backupGame(guildId, game) {
    const key = `${guildId}:${game}`;
    const session = activeGames.get(key);

    if (!session) {
        return false;
    }

    await pool.query(
        `
        INSERT INTO game_backups (guild_id, game, state)
        VALUES ($1, $2, $3)
        ON CONFLICT (guild_id, game)
        DO UPDATE SET
            state = EXCLUDED.state,
            created_at = NOW()
        `,
        [
            guildId,
            game,
            JSON.stringify(session)
        ]
    );

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
        // Chỉ nhận tin nhắn trong đúng channel
        if (message.channelId !== session.channelId) return;

        // Bỏ qua bot
        if (message.author.bot) return;

        // Chỉ nhận số nguyên
        if (!/^\d+$/.test(message.content.trim())) return;

        const number = Number(message.content.trim());

        // Không được chơi 2 lượt liên tiếp
        if (message.author.id === session.lastUserId) {
            await message.react("❌").catch(() => {});

            await message.reply(
                "Bạn không được chơi 2 lượt liên tiếp!\n🔄 Game đã reset về 0."
            ).catch(() => {});

            session.currentNumber = 0;
            session.lastUserId = null;

            return;
        }

        // Phải đúng số tiếp theo
        if (number !== session.currentNumber + 1) {
            await message.react("❌").catch(() => {});

            await message.reply(
                `Sai! Số tiếp theo phải là **${session.currentNumber + 1}**.\n` +
                `Game đã reset về **0**.`
            ).catch(() => {});

            session.currentNumber = 0;
            session.lastUserId = null;

            return;
        }

        // Đúng
        session.currentNumber = number;
        session.lastUserId = message.author.id;

        await message.react("✅").catch(() => {});
    };

    session.messageHandler = messageHandler;

    client.on("messageCreate", messageHandler);

    // Báo bắt đầu
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

    if (!session.wordCache) {
        session.wordCache = new Map();
    }

    async function checkVietnameseWord(word) {
        const normalized = word
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");

        if (session.wordCache.has(normalized)) {
            return session.wordCache.get(normalized);
        }

        try {
            const controller = new AbortController();

            const timeout = setTimeout(() => {
                controller.abort();
            }, 5000);

            const url =
                "https://dict.minhqnd.com/api/v1/lookup" +
                `?word=${encodeURIComponent(normalized)}` +
                "&lang=vi";

            const response = await fetch(url, {
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                throw new Error(
                    `Dictionary API returned ${response.status}`
                );
            }

            const data = await response.json();

            const exists = data.exists === true;

            session.wordCache.set(normalized, exists);

            return exists;

        } catch (error) {
            console.error("Dictionary API error:", error);
            return null;
        }
    }

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
        "cuộc sống"
    ];

    async function chooseStartingPhrase() {
        const shuffled = [...startingPhrases]
            .sort(() => Math.random() - 0.5);

        for (const phrase of shuffled) {
            const normalized = normalizePhrase(phrase);

            const valid = await checkVietnameseWord(normalized);

            if (valid === true) {
                return normalized;
            }
        }

        return null;
    }

    async function startRound() {
        session.currentPhrase = null;
        session.usedWords.clear();

        const startingPhrase = await chooseStartingPhrase();

        if (!startingPhrase) {
            throw new Error(
                "Không tìm được cụm từ mở đầu hợp lệ."
            );
        }

        session.currentPhrase = startingPhrase;
        session.usedWords.add(startingPhrase);

        await channel.send(
            `Nối từ bắt đầu.\n` +
            `Bot: **${startingPhrase}**\n` +
            `Hãy nối với từ **${getLastWord(startingPhrase)}**.`
        );
    }

    async function resetRound(reason) {
        await channel.send(reason).catch(() => {});

        try {
            await startRound();
        } catch (error) {
            console.error("Failed to restart Nối từ:", error);

            await channel.send(
                "⚠️ Không thể bắt đầu lại Nối từ."
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

        // Nối từ phải có ít nhất 2 tiếng
        if (words.length < 2) return;

        // Không được dùng lại cụm từ
        if (session.usedWords.has(phrase)) {
            await message.react("❌").catch(() => {});

            await resetRound(
                "Cụm từ này đã được sử dụng.\n" +
                "Game đang bắt đầu lại."
            );

            return;
        }

        // Kiểm tra tiếng đầu và tiếng cuối
        const requiredWord = getLastWord(session.currentPhrase);
        const firstWord = getFirstWord(phrase);

        if (firstWord !== requiredWord) {
            await message.react("❌").catch(() => {});

            await resetRound(
                `Sai rồi. Cụm từ phải bắt đầu bằng **${requiredWord}**.\n` +
                "Game đang bắt đầu lại."
            );

            return;
        }

        // Kiểm tra dictionary
        const valid = await checkVietnameseWord(phrase);

        // API lỗi
        if (valid === null) {
            await message.react("⚠️").catch(() => {});

            await message.reply(
                "Không thể kết nối tới từ điển lúc này. Hãy thử lại."
            ).catch(() => {});

            return;
        }

        // Không có trong dictionary
        if (!valid) {
            await message.react("❌").catch(() => {});

            await resetRound(
                `Cụm từ **${phrase}** không có trong từ điển.\n` +
                "Game đang bắt đầu lại."
            );

            return;
        }

        // Hợp lệ
        session.currentPhrase = phrase;
        session.usedWords.add(phrase);

        await message.react("✅").catch(() => {});
    };

    session.messageHandler = messageHandler;

    client.on("messageCreate", messageHandler);

    await startRound();
}
async function startMaSoi(session) {
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
            config.channel_id
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
        const config = await getGameConfig(interaction.guildId, game);
    
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
            config.channel_id
        );
    
        if (!started) {
            return interaction.reply({
                content: "Không thể khởi động lại game.",
                ephemeral: true
            });
        }
    
        return interaction.reply({
            content: `Đã khởi động lại ${game}.`,
            ephemeral: true
        });
    }
    if (interaction.commandName === "backup") {
        if (!isGameMaster(interaction.user.id)) {
            return interaction.reply({
                content: "Bạn không có quyền sử dụng lệnh này.",
                ephemeral: true
            });
        }
    
        const gamesToBackup = ["demso", "noitu"];
        const backedUp = [];
    
        try {
            for (const game of gamesToBackup) {
                const success = await backupGame(
                    interaction.guildId,
                    game
                );
    
                if (success) {
                    backedUp.push(game);
                }
            }
    
            if (backedUp.length === 0) {
                return interaction.reply({
                    content: "Không có game Đếm số hoặc Nối từ nào đang chạy.",
                    ephemeral: true
                });
            }
    
            return interaction.reply({
                content:
                    `💾 Đã backup: ${backedUp.join(", ")}.\n` +
                    `Trạng thái đã được lưu tạm vào database.`,
                ephemeral: true
            });
    
        } catch (error) {
            console.error("Backup failed:", error);
    
            return interaction.reply({
                content: "Không thể backup game.",
                ephemeral: true
            });
        }
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
