import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { PPTXLoader } from "@langchain/community/document_loaders/fs/pptx";
import { TextLoader } from "langchain/document_loaders/fs/text";

export const readFile = async ({ fileName, filePath }: { filePath: string, fileName: string }) => {
    const fileExtension = fileName.split('.').pop()?.toLowerCase();
    let loader;

    switch (fileExtension) {
        case 'pdf':
            loader = new PDFLoader(filePath, {
                splitPages: false,
                parsedItemSeparator: "",
            });
            break;
        case 'docx':
            loader = new DocxLoader(filePath);
            break;
        case 'doc':
            loader = new DocxLoader(filePath);
            break;
        case 'pptx':
            loader = new PPTXLoader(filePath);
            break;
        case 'txt':
            loader = new TextLoader(filePath);
            break;
        default:
            throw new Error(`Unsupported file type: ${fileExtension}`);
    }
    // Load and return the documents
    return await loader.load();
}