"use client";

import { useRef, useState } from "react";
import { Button } from "@/shadcn/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shadcn/ui/dropdown-menu";
import { mediator } from "@/utils/mediator";
import { toast } from "sonner";
import { useAgentContext } from "./AgentsDetail";

type FileType = "pdf" | "docx" | "doc" | "pptx" | "txt";

const SUPPORTED_FILE_TYPES: FileType[] = ["pdf", "docx", "doc", "pptx", "txt"];

type UploadFileDropdownProps = {
  refreshData: () => void;
};

export const UploadFileDropdown: React.FC<UploadFileDropdownProps> = ({
  refreshData,
}) => {
  const { botId } = useAgentContext();
  const [selectedType, setSelectedType] = useState<FileType | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleTypeSelect = (type: FileType) => {
    setSelectedType(type);

    // Dynamically set accept attribute before opening file picker
    if (inputRef.current) {
      inputRef.current.accept = `.${type}`;
      inputRef.current.value = ""; // reset previous selection
      inputRef.current.click(); // open native file picker
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFileToServer(file);
  };

  const uploadFileToServer = async (file: File) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      setUploading(true);
      const response = await mediator.post(`/kb/upload/${botId}`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      setUploading(false);
      toast(response.data.message);
      refreshData();
    } catch (error: any) {
      console.log(error);
      if (error.data.message) {
        toast(error.data.message);
      }
    }
  };

  return (
    <div>
      {/* Hidden native file input */}
      <input
        type="file"
        ref={inputRef}
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Dropdown to select file type */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            {selectedType
              ? uploading
                ? `Uploading ${selectedType.toUpperCase()}...`
                : `Upload File`
              : "Upload File"}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent>
          {SUPPORTED_FILE_TYPES.map((type) => (
            <DropdownMenuItem key={type} onClick={() => handleTypeSelect(type)}>
              {type.toUpperCase()}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
