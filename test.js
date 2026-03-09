// test.js
require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic.Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

async function test() {
    try {
        const response = await client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 100,
            messages: [{
                role: "user",
                content: "Say hello in one sentence."
            }]
        });

        console.log("API key works!");
        console.log("Response:", response.content[0].text);
    } catch (err) {
        console.error("API key failed:", err.message);
    }
}

test();