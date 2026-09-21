/** Remove a leading UTF-8 byte-order mark, which would otherwise shift column 0 and confuse parsers. */
export const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
