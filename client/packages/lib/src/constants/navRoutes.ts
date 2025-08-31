import { CONST_PAGE_ROUTES } from "./baseRoute";

export interface NavItemProps {
  label: string;
  to?: string;
  include?: string;
  permission?: string;
  items?: NavItemProps[];
}

export const navItems: NavItemProps[] = [
  {
    to: CONST_PAGE_ROUTES.home,
    label: "Home",
    include: "/app/home",
    permission: "HOME_NAV",
  },
  // {
  //   label: "Master",
  //   include: "xyz",
  //   items: [
  //     {
  //       label: "Employees",
  //       include: "/app/employees",
  //       to: CONST_PAGES_EMPLOYEES.overview.pathname,
  //       permission: "PROFILE_NAV",
  //     },
  //     {
  //       label: "Leave-Types",
  //       include: "/app/leave-types",
  //       to: CONST_PAGE_LEAVE_TYPE.overview.pathname,
  //       permission: "LEAVE_TYPE_NAV",
  //     },
  //     {
  //       label: "Holiday List",
  //       include: "/app/holiday",
  //       to: CONST_PAGE_HOLIDAY.overview.pathname,
  //       permission: "LEAVE_NAV",
  //     },
  //     {
  //       label: "Skills",
  //       include: "/app/skills",
  //       to: CONST_PAGE_SKILLS.overview.pathname,
  //       permission: "SKILL_NAV",
  //     },
  //     {
  //       label: "Departments",
  //       include: "/app/departments",
  //       to: CONST_PAGE_DEPARTMENTS.overview.pathname,
  //       permission: "DEPARTMENT_NAV",
  //     },
  //     {
  //       label: "Projects",
  //       include: "/app/projects",
  //       to: CONST_PAGE_PROJECTS.overview.pathname,
  //       permission: "PROJECT_NAV",
  //     },
  //     {
  //       to: CONST_PAGE_VISA.overview.pathname,
  //       label: "Visa",
  //       include: "/app/visa",
  //       permission: "VISA_NAV",
  //     },
  //     {
  //       to: CONST_PAGE_TRAVEL_DATA.overview.pathname,
  //       label: "Travel Data",
  //       include: "/app/travel-data",
  //       permission: "TRAVEL_DATA_NAV",
  //     },
  //   ],
  // },

];
