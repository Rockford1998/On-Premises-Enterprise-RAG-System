export const generateFileHash = async ({ filePath }: { filePath: string }): Promise<string> => {
    const { createHash } = await import("node:crypto");
    const { readFile } = await import("node:fs/promises");
    try {
        const fileBuffer = await readFile(filePath);
        const hash = createHash("sha256").update(fileBuffer).digest("hex");
        console.log(`Generated hash for file ${filePath}: ${hash}`);
        return hash;
    } catch (error) {
        console.error(`Error generating hash for file ${filePath}:`, error);
        throw error;
    }
}   