import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

// FORCE DYNAMIC to avoid caching static builds
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const supabase = getServiceSupabase();
        const TEST_ID = '8c09adb0-0525-4811-925d-6678fa1a8cb8'; // User provided ID

        // Debug info
        const keySuffix = process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(-5) || 'NONE';
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'NONE';

        console.log(`Debug Check: Querying ID ${TEST_ID} with KeyEnding: ${keySuffix} at URL: ${url}`);

        const { data, error } = await supabase
            .from('enriched_leads')
            .select('*')
            .eq('id', TEST_ID)
            .single();

        return NextResponse.json({
            status: 'completed',
            is_success: !!data,
            found_data: data,
            error: error ? error.message : null,
            debug_info: {
                target_id: TEST_ID,
                key_suffix: keySuffix,
                supabase_url: url
            }
        });
    } catch (err: any) {
        return NextResponse.json({
            status: 'error',
            error: err.message
        }, { status: 500 });
    }
}
