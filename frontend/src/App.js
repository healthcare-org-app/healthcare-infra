import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Outlet, Route, Routes } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { Dashboard } from "@/pages/Dashboard";
import { DomainLanding } from "@/pages/DomainLanding";
import { ServicePage } from "@/pages/ServicePage";
import { RecordDetail } from "@/pages/RecordDetail";
import { Login } from "@/pages/Login";
import { RequireAuth } from "@/auth";
function Shell() {
    return (_jsxs("div", { className: "flex flex-col h-full", children: [_jsx(TopBar, {}), _jsxs("div", { className: "flex flex-1 min-h-0", children: [_jsx(Sidebar, {}), _jsx("main", { className: "flex-1 overflow-y-auto", children: _jsx(Outlet, {}) })] })] }));
}
export default function App() {
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(Login, {}) }), _jsx(Route, { element: _jsx(RequireAuth, {}), children: _jsxs(Route, { element: _jsx(Shell, {}), children: [_jsx(Route, { path: "/", element: _jsx(Dashboard, {}) }), _jsx(Route, { path: "/domain/:domain", element: _jsx(DomainLanding, {}) }), _jsx(Route, { path: "/service/:name", element: _jsx(ServicePage, {}) }), _jsx(Route, { path: "/service/:name/:id", element: _jsx(RecordDetail, {}) }), _jsx(Route, { path: "*", element: _jsx("div", { className: "p-8", children: "Not found" }) })] }) })] }));
}
