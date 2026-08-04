import { theme, type ThemeConfig } from "antd";

/**
 * Local ConfigProvider theme for the Model Vetting Studio admin surface.
 * Kept local (not imported from @openclinxr/ui-shared) so this capability-arena
 * app does not add a cross-boundary workspace dependency. Tokens echo the
 * studio's isolated-lab palette (deep green stage + teal accents).
 */
export const openClinXrVettingTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: "#2f9e78",
    colorInfo: "#2f9e78",
    colorBgBase: "#141d19",
    colorBgContainer: "#18211d",
    colorBorder: "#31483f",
    colorSuccess: "#52c41a",
    colorWarning: "#e0a30c",
    colorError: "#d4380d",
    borderRadius: 8,
    fontSize: 14,
  },
  components: {
    Table: {
      headerBg: "#1c2723",
      headerColor: "#cde7dc",
      rowHoverBg: "#20302a",
    },
    Card: {
      colorBgContainer: "#18211d",
    },
    Modal: {
      contentBg: "#141d19",
      headerBg: "#141d19",
    },
  },
};
