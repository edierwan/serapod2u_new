const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkConstraints() {
  // Try to update one master code to 'packed' to see the error
  const { data: masterCode } = await supabase
    .from('qr_master_codes')
    .select('id')
    .eq('status', 'printed')
    .limit(1)
    .single();

  if (!masterCode) {
    console.log('No printed master code found');
    return;
  }

  console.log('Attempting to update master code:', masterCode.id);

  const { error } = await supabase
    .from('qr_master_codes')
    .update({ status: 'packed' })
    .eq('id', masterCode.id);

  if (error) {
    console.error('Error updating master code:', error);
  } else {
    console.log('Success!');
    // Revert
    await supabase
      .from('qr_master_codes')
      .update({ status: 'printed' })
      .eq('id', masterCode.id);
  }
}

checkConstraints();
