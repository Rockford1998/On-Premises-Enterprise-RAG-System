import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 10);

export const generateBotId = (): string => {
    return `BOT-${nanoid()}`;
};

// Example usage
console.log(generateBotId()); // e.g., BOT-A7Z4M2QWL9
