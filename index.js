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
    { name: "Ma Sói", value: "masoi" },
    { name: "Tù xì", value: "tuxi" }
];

const GAME_MASTERS = new Set([
    "1003155311084978266",
    "1504862059232366818",
    "1422193218006679745",
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
        channelId
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

    if (!activeGames.has(key)) {
        return false;
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
    tuxi: startTuXi
};

async function startDemSo(session) {
}

async function startNoiTu(session) {
}

async function startMaSoi(session) {
}

async function startTuXi(session) {
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
        const config = await getGameConfig(interaction.guildId, game);
    
        if (!config) {
            return interaction.reply({
                content: "Game này chưa được setup.",
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
                content: "Game này đang chạy hoặc không tồn tại.",
                ephemeral: true
            });
        }
    
        return interaction.reply({
            content: `Đã bắt đầu ${game}.`,
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
