const BASE_TYPED = new Set(["id", "status", "created_at", "updated_at"]);
const PATIENTS_TYPED = new Set(["first_name", "last_name", "dob", "mrn", "identity_sub"]);
function typedColumns(table) {
    if (table === "patients")
        return new Set([...BASE_TYPED, ...PATIENTS_TYPED]);
    return BASE_TYPED;
}
export function splitBody(table, body) {
    const typed = typedColumns(table);
    const out = {};
    const data = {};
    for (const [k, v] of Object.entries(body)) {
        if (k === "data" && v && typeof v === "object") {
            Object.assign(data, v);
        }
        else if (typed.has(k)) {
            out[k] = v;
        }
        else {
            data[k] = v;
        }
    }
    if (Object.keys(data).length > 0)
        out.data = data;
    return out;
}
export function mergeRow(row) {
    if (!row)
        return row;
    const { data, ...rest } = row;
    if (data && typeof data === "object") {
        return { ...data, ...rest };
    }
    return rest;
}
