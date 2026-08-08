import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

export const askGemini = async (prompt) => {
    const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
    });

    return response.text;
};

export const summarizeMail = async (subject, message) => {
    const prompt = `
Summarize the following email in 2-3 short sentences.

Subject: ${subject}

Email:
${message}

Give only the summary.
`;

    const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
    });

    return response.text;
};

export const generateMailReply = async (subject, message) => {
    const prompt = `
You are an AI email assistant.

Read the email below carefully and write a natural reply as if the user is replying personally.

Subject:
${subject}

Email:
${message}

Instructions:
- Understand the actual intent of the email before replying.
- Reply directly to what the sender said.
- Keep the reply concise and natural.
- Match the tone of the original email.
- If the sender asks a question, answer it based only on the information available.
- Do not invent facts, dates, times, names, or commitments.
- Do not repeat the entire original email.
- Do not use placeholders such as [Your Name], [Company Name], etc.
- Do not add a subject line.
- Give only the email reply body.
`;

    const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
    });

    return response.text;
};

export const suggestMailSubject = async (message) => {
    const prompt = `
Suggest a clear and concise subject line for the following email.

Email:
${message}

Instructions:
- Understand the main purpose of the email.
- Give only one subject line.
- Keep it short and professional.
- Do not use "Subject:" before the answer.
- Do not use quotes.
`;

    const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
    });

    return response.text.trim();
};

export const extractImportantPoints = async (message) => {
    const prompt = `
You are an AI assistant for an email application.

Analyze the email and extract only the information that the recipient should remember or act on.

Email:
${message}

Return the key information in short, useful points.

Focus on:
- Important dates
- Important times
- Deadlines
- Meetings
- Requests
- Tasks
- Required documents
- Payments
- Confirmations
- Decisions
- Action items

Rules:
- Do not rewrite the email.
- Do not create a summary.
- Do not repeat unnecessary sentences.
- Do not invent information.
- Combine related information into one point when appropriate.
- Keep each point short, preferably under 12 words.
- Maximum 5 points.
- Return ONLY a JSON array of strings.
- Do not use markdown.
- Do not add any explanation.

Example:

Email:
"Your interview is Monday at 11 AM. Please bring your resume and ID proof and confirm your availability."

Output:
["Interview: Monday at 11 AM", "Bring resume and ID proof", "Confirm availability"]

Now analyze the provided email.
`;

    const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
    });

    const text = response.text.trim();

    try {
        return JSON.parse(text);
    } catch (error) {
        return [text];
    }
};