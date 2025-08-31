import React, { useState, useEffect, useRef, type ReactNode } from "react";
import { Box, Drawer, Button, Divider, Tooltip } from "@mui/material";
import { MoreVert } from "@mui/icons-material";

interface PageWrapProps {
  children: React.ReactNode;
  // crumbs: BreadcrumbsProps["crums"];
  rights?: React.ReactNode;
  primaryActions?: React.ReactNode[];
  secondaryActions?: React.ReactNode[];
  status?: React.ReactNode;
}

export const PageWrap = ({
  children,
  // crumbs,
  primaryActions,
  secondaryActions,
  status,
}: PageWrapProps) => {
  // const accessToken = useStoreAuth((state) => state.accessToken) || "";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const actionSpaceRef = useRef<HTMLDivElement | null>(null);
  const [visiblePrimaryActions, setVisiblePrimaryActions] = useState<
    ReactNode[]
  >([]);
  const [visibleSecondaryActions, setVisibleSecondaryActions] = useState<
    ReactNode[]
  >([]);
  const [overflowActions, setOverflowActions] = useState<ReactNode[]>([]);

  // useEffect(() => {
  // if (!accessToken) return;

  //   const fetchPermissions = async () => {
  //     try {
  //       const payload = await verifyAccessToken(accessToken);
  //       setUserPermissions(new Set(payload.data.actions));
  //     } catch (error) {
  //       console.error("Error verifying access token:", error);
  //       setUserPermissions(new Set());
  //     }
  //   };

  //   fetchPermissions();
  // }, [accessToken]);

  useEffect(() => {
    if (!primaryActions?.length && !secondaryActions?.length) return;

    const adjustActionButtons = () => {
      if (!actionSpaceRef.current) return;

      let totalWidth = 0;
      const availableWidth = actionSpaceRef.current.clientWidth;
      const newVisibleSecondaryActions: ReactNode[] = [];
      const newVisiblePrimaryActions: ReactNode[] = [];
      const newOverflowActions: ReactNode[] = [];

      const buttonPadding = 40;
      const moreButtonWidth = 60;

      // const isActionAllowed = (action: ReactNode) => {
      //   if (!React.isValidElement(action)) return true;
      //   const permissionName = action.props?.permissionName;
      //   return permissionName ? userPermissions.has(permissionName) : true;
      // };

      const processActions = (
        actions: ReactNode[] | undefined,
        visibleActions: ReactNode[]
      ) => {
        if (!actions) return;

        actions?.forEach((action) => {
          // if (!isActionAllowed(action)) return;

          const actionWidth = 100 + buttonPadding;
          if (totalWidth + actionWidth < availableWidth - moreButtonWidth) {
            visibleActions.push(action);
            totalWidth += actionWidth;
          } else {
            newOverflowActions.push(action);
          }
        });
      };

      processActions(primaryActions, newVisiblePrimaryActions);
      processActions(secondaryActions, newVisibleSecondaryActions);
      setVisiblePrimaryActions(newVisiblePrimaryActions);
      setVisibleSecondaryActions(newVisibleSecondaryActions);
      setOverflowActions(newOverflowActions);
    };

    const observer = new ResizeObserver(adjustActionButtons);
    if (actionSpaceRef.current) observer.observe(actionSpaceRef.current);

    window.addEventListener("resize", adjustActionButtons);
    adjustActionButtons();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", adjustActionButtons);
    };
  }, [secondaryActions, primaryActions]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Box
        className="page-wrap-header"
        sx={{
          p: 1,
          gap: 1,
          display: "grid",
          gridTemplateColumns: "auto auto 1fr",
          alignItems: "center",
          width: "100%",
          height: 50,
        }}
      >
        {/* <Box sx={{ minWidth: "fit-content" }}>
          <Breadcrumb
            crums={crumbs}
            maxItems={3}
            itemsBeforeCollapse={1}
            itemsAfterCollapse={1}
          />
        </Box> */}

        {status ? (
          <Box sx={{ textAlign: "left", textOverflow: "ellipsis" }}>
            {status}
          </Box>
        ) : (
          <Box sx={{ flex: 1 }} />
        )}

        <Box
          ref={actionSpaceRef}
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            width: "100%",
            gap: 1,
            "& > *": {
              flexShrink: 0,
            },
            overflow: "hidden",
          }}
        >
          {overflowActions.length > 0 && (
            <>
              <Tooltip arrow title={"More"} disableInteractive>
                <Button
                  sx={{ minWidth: 0, ":hover": { color: "secondary.main" } }}
                  onClick={() => setDrawerOpen(true)}
                >
                  <MoreVert fontSize="small" />
                </Button>
              </Tooltip>

              <Drawer
                anchor="top"
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
              >
                <Box
                  sx={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 1,
                    p: 1.5,
                    maxHeight: "30dvh",
                    overflowY: "auto",
                    "& > *": {
                      flexShrink: 0,
                    },
                  }}
                >
                  {overflowActions.map((action, index) => (
                    <Box key={index}>{action}</Box>
                  ))}
                </Box>
              </Drawer>
            </>
          )}
          {visibleSecondaryActions.map((action, index) => (
            <Box key={index}>{action}</Box>
          ))}
          {visiblePrimaryActions.length > 0 &&
          visibleSecondaryActions.length > 0 ? (
            <Divider orientation="vertical" flexItem />
          ) : null}
          {visiblePrimaryActions.map((action, index) => (
            <Box key={index}>{action}</Box>
          ))}
        </Box>
      </Box>

      <Box>{children}</Box>
    </Box>
  );
};
