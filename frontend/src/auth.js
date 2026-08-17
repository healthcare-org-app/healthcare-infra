import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useState, } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { supabase } from "@/supabase";
const Ctx = createContext(null);
export function AuthProvider({ children }) {
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session);
            setLoading(false);
        });
        const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
        return () => sub.subscription.unsubscribe();
    }, []);
    const value = {
        session,
        loading,
        signInWithMagicLink: async (email) => {
            const { error } = await supabase.auth.signInWithOtp({
                email,
                options: { emailRedirectTo: window.location.origin },
            });
            return { error };
        },
        signOut: async () => {
            await supabase.auth.signOut();
        },
    };
    return _jsx(Ctx.Provider, { value: value, children: children });
}
export function useAuth() {
    const v = useContext(Ctx);
    if (!v)
        throw new Error("useAuth must be used inside <AuthProvider>");
    return v;
}
export function RequireAuth() {
    const { session, loading } = useAuth();
    const loc = useLocation();
    if (loading)
        return null;
    if (!session)
        return _jsx(Navigate, { to: "/login", replace: true, state: { from: loc } });
    return _jsx(Outlet, {});
}
