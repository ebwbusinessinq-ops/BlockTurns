import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName("ask")
        .setDescription("Submit a question directly to the server staff team")
        .addStringOption(option =>
            option
                .setName("question")
                .setDescription("What is your question?")
                .setRequired(true)
        ),
    category: "moderation", // Matches your existing category rules

    async execute(interaction, config, client) {
        const question = interaction.options.getString("question");

        // 🛠️ CONFIGURATION: Replace these values with your actual server IDs
        const STAFF_ROLE_ID = "1041459758500155583";   // The ID of the role you want to ping
        const ALERT_CHANNEL_ID = "1496675062701359175"; // The channel ID where staff logs questions

        const targetChannel = interaction.guild.channels.cache.get(ALERT_CHANNEL_ID);
        
        // Error handling if staff channel configuration is broken
        if (!targetChannel) {
            logger.error(`Ask command error: Target alert channel ${ALERT_CHANNEL_ID} not found.`);
            return await interaction.reply({ 
                content: "❌ **System Setup Error:** The staff alert logging channel could not be found.", 
                flags: [MessageFlags.Ephemeral] 
            });
        }

        try {
            // 1. Build a clean question log card for the staff channel
            const questionEmbed = createEmbed({
                title: "❓ New Community Question",
                description: question,
                color: "#FEE75C", // Clean Yellow accent accent line
            })
            .setAuthor({ 
                name: interaction.user.tag, 
                iconURL: interaction.user.displayAvatarURL({ dynamic: true }) 
            })
            .addFields({ name: "Asked By", value: `${interaction.user} (${interaction.user.id})` })
            .setTimestamp();

            // 2. Alert the staff team in their private channel with the ping and embed
            await targetChannel.send({
                content: `<@&${STAFF_ROLE_ID}>`, 
                embeds: [questionEmbed]
            });

            // 3. Send a private (ephemeral) confirmation message back to the user
            return await interaction.reply({
                embeds: [
                    successEmbed(
                        "Question Submitted!",
                        "Your question has been securely forwarded to our server staff team. Thank you!"
                    )
                ],
                flags: [MessageFlags.Ephemeral] // Only visible to the person who ran the command
            });

        } catch (error) {
            logger.error("Error executing /ask command:", error);
            return await interaction.reply({ 
                content: "❌ Failed to deliver your question. Please try again later.", 
                flags: [MessageFlags.Ephemeral] 
            }).catch(() => null);
        }
    }
};
