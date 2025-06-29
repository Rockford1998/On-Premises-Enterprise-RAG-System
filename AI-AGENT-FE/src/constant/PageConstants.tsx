import SettingsIcon from "@mui/icons-material/Settings";
import RateReviewOutlinedIcon from "@mui/icons-material/RateReviewOutlined";

export const PageConstants = {
  chat: {
    label: "Chat",
    to: "/",
    path: "/",
    icon: <RateReviewOutlinedIcon />,
  },
  settings: {
    label: "Settings",
    to: "/settings",
    path: "/settings",
    icon: <SettingsIcon />,
  },
};

export type PageType = keyof typeof PageConstants;
