import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    const ids = searchParams.getAll("ids"); // Support ?ids=1&ids=2

    if ((!query || query.length < 2) && ids.length === 0) {
        return NextResponse.json({ users: [] });
    }

    const supabase = await createClient(); // Wait for client creation

    // Check if user is admin/super_admin - basic check, can be improved
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let queryBuilder = supabase
        .from('users')
        .select('id, full_name, email, phone');

    if (ids.length > 0) {
        queryBuilder = queryBuilder.in('id', ids);
    } else if (query) {
        queryBuilder = queryBuilder.or(`full_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`).limit(10);
    }

    const { data: users, error } = await queryBuilder;

    if (error) {
        console.error("Search users error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ users });
}
