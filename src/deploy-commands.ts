import { REST, Routes } from "discord.js";
import { commandData } from "./commands/definitions.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
const deployGlobally = process.argv.includes("--global");

if (!deployGlobally && config.DISCORD_GUILD_ID) {
  await rest.put(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID), {
    body: commandData,
  });
  console.log(`Registered ${commandData.length} guild commands.`);
} else {
  await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), {
    body: commandData,
  });
  console.log(`Registered ${commandData.length} global commands.`);
}
