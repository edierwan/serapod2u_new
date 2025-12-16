#!/usr/bin/env python3
"""
Preprod Database Migration Script
Migrates schema and admin user from production to preprod Supabase
"""

import subprocess
import sys
import os

# Connection settings
SOURCE_HOST = "aws-1-ap-southeast-1.pooler.supabase.com"
SOURCE_PORT = "5432"
SOURCE_USER = "postgres.bamybvzufxijghzqdytu"
SOURCE_DB = "postgres"

TARGET_HOST = "aws-1-ap-southeast-1.pooler.supabase.com"
TARGET_PORT = "5432"
TARGET_USER = "postgres.jqihlckqrhdxszgwuymu"
TARGET_DB = "postgres"

PASSWORD = "Turun_2020-"

# Tables that are actually used by the application (based on codebase analysis)
REQUIRED_TABLES = [
    # Core authentication and user management
    "roles",
    "users",
    "organization_types",
    "organizations",
    
    # Geographic data
    "regions",
    "states",
    "districts",
    
    # Product management
    "brands",
    "product_categories",
    "product_groups",
    "product_subgroups",
    "products",
    "product_variants",
    "product_attributes",
    "product_images",
    "product_pricing",
    "product_inventory",
    "product_skus",
    
    # Order management
    "orders",
    "order_items",
    "payment_terms",
    
    # QR code management
    "qr_batches",
    "qr_codes",
    "qr_master_codes",
    "qr_movements",
    "qr_prepared_codes",
    "qr_reverse_jobs",
    "qr_reverse_job_items",
    "qr_reverse_job_logs",
    "qr_secret_codes",
    "qr_validation_reports",
    
    # Documents
    "documents",
    "document_files",
    "document_signatures",
    "doc_counters",
    
    # Inventory and stock
    "stock_movements",
    "stock_transfers",
    "stock_adjustments",
    "stock_adjustment_items",
    "stock_adjustment_reasons",
    "stock_adjustment_manufacturer_actions",
    "wms_movement_dedup",
    
    # Distribution
    "distributor_products",
    "shop_distributors",
    
    # Journey/Campaign configurations
    "journey_configurations",
    "journey_order_links",
    
    # Lucky draw
    "lucky_draw_campaigns",
    "lucky_draw_entries",
    "lucky_draw_order_links",
    
    # Scratch card
    "scratch_card_campaigns",
    "scratch_card_rewards",
    "scratch_card_plays",
    
    # Spin wheel
    "spin_wheel_campaigns",
    "spin_wheel_rewards",
    "spin_wheel_plays",
    
    # Daily quiz
    "daily_quiz_campaigns",
    "daily_quiz_questions",
    "daily_quiz_plays",
    
    # Points and rewards
    "points_rules",
    "points_transactions",
    "point_rewards",
    
    # Consumer engagement
    "consumer_activations",
    "consumer_feedback",
    "consumer_qr_scans",
    
    # Redemption
    "redeem_items",
    "redeem_gifts",
    "redeem_gift_transactions",
    "redemption_policies",
    "redemption_orders",
    "redemption_order_limits",
    "redemption_gifts",
    
    # Notifications
    "notification_types",
    "notification_settings",
    "notification_provider_configs",
    "notification_logs",
    "notifications_outbox",
    "org_notification_settings",
    "message_templates",
    "email_send_log",
    
    # OTP
    "otp_challenges",
    
    # Audit
    "audit_logs",
]

# Tables to exclude (not used or social features not needed)
EXCLUDED_TABLES = [
    # These are typically managed by Supabase automatically
    # or are part of unused features
]

def run_psql(host, user, db, sql, capture_output=True):
    """Run psql command"""
    env = os.environ.copy()
    env['PGPASSWORD'] = PASSWORD
    
    cmd = [
        'psql',
        '-h', host,
        '-p', '5432',
        '-U', user,
        '-d', db,
        '--set', 'ON_ERROR_STOP=on',
        '-c', sql
    ]
    
    result = subprocess.run(cmd, env=env, capture_output=capture_output, text=True)
    if result.returncode != 0:
        print(f"Error: {result.stderr}")
    return result

def run_psql_file(host, user, db, filename):
    """Run psql with a SQL file"""
    env = os.environ.copy()
    env['PGPASSWORD'] = PASSWORD
    
    cmd = [
        'psql',
        '-h', host,
        '-p', '5432',
        '-U', user,
        '-d', db,
        '-f', filename
    ]
    
    result = subprocess.run(cmd, env=env, capture_output=True, text=True)
    return result

def pg_dump_schema(tables=None, include_data=False):
    """Dump schema from source database"""
    env = os.environ.copy()
    env['PGPASSWORD'] = PASSWORD
    
    cmd = [
        'pg_dump',
        '-h', SOURCE_HOST,
        '-p', SOURCE_PORT,
        '-U', SOURCE_USER,
        '-d', SOURCE_DB,
        '--no-owner',
        '--no-acl',
        '-n', 'public',
    ]
    
    if not include_data:
        cmd.append('--schema-only')
    
    if tables:
        for table in tables:
            cmd.extend(['-t', f'public.{table}'])
    
    result = subprocess.run(cmd, env=env, capture_output=True, text=True)
    return result.stdout

def main():
    print("=" * 60)
    print("PREPROD DATABASE MIGRATION")
    print("=" * 60)
    
    # Step 1: Export schema
    print("\n[Step 1] Exporting schema from source database...")
    
    schema_sql = pg_dump_schema()
    
    # Save schema for review
    with open('preprod_schema_export.sql', 'w') as f:
        f.write(schema_sql)
    print(f"Schema exported to preprod_schema_export.sql ({len(schema_sql)} bytes)")
    
    # Step 2: Apply to target
    print("\n[Step 2] This will apply schema to target database.")
    print(f"Target: {TARGET_HOST} / {TARGET_USER}")
    
    confirm = input("Continue? (yes/no): ")
    if confirm.lower() != 'yes':
        print("Aborted.")
        return
    
    result = run_psql_file(TARGET_HOST, TARGET_USER, TARGET_DB, 'preprod_schema_export.sql')
    
    if result.returncode == 0:
        print("Schema applied successfully!")
    else:
        print("Schema application had issues:")
        print(result.stderr[:2000] if result.stderr else "No error output")
    
    print("\n[Step 3] Migration complete!")
    print("\nNext steps:")
    print("1. Migrate admin user manually")
    print("2. Update preprod environment variables")
    print("3. Test login functionality")

if __name__ == "__main__":
    main()
