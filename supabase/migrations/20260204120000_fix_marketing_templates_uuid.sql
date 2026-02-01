
-- Fix marketing_templates to ensure ID is UUID and remove junk data
-- This addresses the issue where "2" (a string/number) is being passed as template_id
-- which causes "invalid input syntax for type uuid" when inserting into marketing_campaigns

DO $$ 
BEGIN
    -- 1. First, enable the uuid-ossp extension if not exists (usually standard, but good to ensure)
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    -- 2. Check if the 'id' column of 'marketing_templates' is NOT uuid (i.e. if it's text/varchar/int)
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'marketing_templates' 
        AND column_name = 'id' 
        AND data_type NOT IN ('uuid')
    ) THEN
        -- It's not UUID. We need to clean up bad data and convert it.
        
        -- Delete any rows where ID is not a valid UUID format
        -- (Simple regex check for UUID standard format)
        DELETE FROM marketing_templates 
        WHERE id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
        
        -- Convert the column to UUID
        ALTER TABLE marketing_templates 
        ALTER COLUMN id TYPE UUID USING id::uuid;
        
        -- Ensure default value is gen_random_uuid
        ALTER TABLE marketing_templates 
        ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ELSE
        -- ID is already UUID. Check for any inconsistencies or just to be safe,
        -- if we can't select "2" from it, we are good.
        -- But wait, if previous migration failed, maybe we just have bad data that looks like UUID but isn't? Unlikely for UUID column.
        -- Maybe we want to remove specific junk if it somehow got in (unlikely for UUID type).
        NULL;
    END IF;

    -- 3. Clean up any remaining mock templates that might have "1", "2", "3" as names or something, 
    -- just in case the id was correct but the content was mock.
    DELETE FROM marketing_templates WHERE name IN ('Start from Scratch', 'Standard Promo', 'Points Reminder') AND is_system = true;
    
    -- 4. Re-insert System Templates properly (ensuring they have valid UUIDs)
    -- We delete based on category/name to avoid duplicates before inserting
    DELETE FROM marketing_templates WHERE is_system = true;

    INSERT INTO marketing_templates (org_id, name, category, body, variables, is_system) VALUES
    -- PROMOTIONAL
    (NULL, 'Flash Sale Alert', 'Promotional', '🔥 FLASH SALE ALERT! 🔥\n\nHi {name}! \n\nWe are having a 24-hour flash sale starting NOW! Get 20% OFF storewide.\n\nUse code: FLASH20 at checkout.\n\nShop here: {short_link}\n\nHurry, limited stock available!', '["{name}", "{short_link}"]', true),
    (NULL, 'New Arrival Announcement', 'Promotional', '✨ New Arrivals are here! ✨\n\nHello {name}, check out our latest collection just dropped in store. \n\nBe the first to browse: {short_link}\n\nSee you fast!', '["{name}", "{short_link}"]', true),

    -- ENGAGEMENT
    (NULL, 'We Miss You', 'Engagement', 'We miss you, {name}! 💔\n\nIt''s been a while since we last saw you. Here''s 15% OFF to welcome you back: \n\nUse code: COMEBACK15\n\nBrowse what''s new: {short_link}\n\nWe hope to see you soon!', '["{name}", "{short_link}"]', true),
    (NULL, 'Customer Feedback Survey', 'Engagement', 'Hi {name}! We value your opinion! 📝\n\nTake our 2-minute survey and help us serve you better. As a thank you, you''ll receive 50 bonus points!\n\nSurvey link: {short_link}\n\nYour feedback matters!', '["{name}", "{short_link}"]', true),
    
    -- INFORMATIONAL
    (NULL, 'Store Hours Update', 'Informational', '📢 Important Update, {name}\n\nOur operating hours have been updated:\n🕒 Monday - Friday: 10am - 9pm\n🕒 Saturday - Sunday: 9am - 10pm\n\nVisit us anytime! 📍', '["{name}"]', true),
    
    -- LOYALTY
    (NULL, 'Points Balance Reminder', 'Loyalty', 'Hi {name} 👋\n\nYou currently have {points_balance} points in your wallet! 💰\n\nDon''t let them expire. Redeem them for exciting rewards today:\n{short_link}\n\nHappy redeeming!', '["{name}", "{points_balance}", "{short_link}"]', true),
    (NULL, 'Birthday Treat', 'Loyalty', 'Happy Birthday {name}! 🎂\n\nTo celebrate your special day, we''ve credited 500 bonus points to your account! \n\nTreat yourself to something nice: {short_link}\n\nHave a fantastic day!', '["{name}", "{short_link}"]', true);

END $$;

NOTIFY pgrst, 'reload schema';
