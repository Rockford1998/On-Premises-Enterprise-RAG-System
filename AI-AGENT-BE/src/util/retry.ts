export const retry = async <T>(
    fn: () => Promise<T>,
    maxRetries: number,
    delayMs: number
): Promise<T> => {
    let attempts = 0;

    while (true) {
        try {
            return await fn();
        } catch (error) {
            if (++attempts >= maxRetries) throw error;
            await new Promise(resolve => setTimeout(resolve, delayMs * attempts));
        }
    }
};