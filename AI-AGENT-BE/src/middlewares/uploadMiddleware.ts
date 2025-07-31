import multer from "multer";
import fs from "fs";
import path from "path";

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const botId = req.params.botId;
    const botDir = path.join("uploads", botId);

    // Create directory if it doesn't exist
    if (!fs.existsSync(botDir)) {
      fs.mkdirSync(botDir, { recursive: true });
    }

    cb(null, botDir);
  },
  filename: function (_, file, cb) {
    cb(null, file.originalname);
  },
});

export const upload = multer({ storage });
