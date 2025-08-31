import Snackbar from "@mui/material/Snackbar";
import { useStoreNotification } from "../../store/useStoreNotification";
import Alert from "@mui/material/Alert";
import Slide from "@mui/material/Slide";

export const Notification = () => {
  const open = useStoreNotification((store) => store.open);
  const level = useStoreNotification((store) => store.level);
  const message = useStoreNotification((store) => store.message);
  const handleClose = useStoreNotification((store) => store.handleClose);

  return (
    <Snackbar
      open={open}
      autoHideDuration={4000}
      onClose={handleClose}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
      TransitionComponent={(props) => (
        <Slide {...props} unmountOnExit direction="down" />
      )}
    >
      <Alert
        variant="standard"
        onClose={handleClose}
        severity={level}
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 1,
          boxShadow: 4,
          width: "100%",
        }}
      >
        {message}
      </Alert>
    </Snackbar>
  );
};
