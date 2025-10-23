# 📦 Migration Template Update - Complete Product Data Integration

## 🎯 Overview

Updated migration templates to include **ALL** required fields for seamless data integration with master data relationships. The system now properly handles product hierarchies, variants, and inventory with full relational integrity.

---

## ⚠️ Critical Changes Made

### 1. **Product Template - Complete Restructure**

#### ❌ What Was Missing (Before):
```
Product Code, Product Name, Brand Name, Category, Description, Is Vape, Age Restriction
```
**Problems:**
- ❌ No Group/SubGroup fields
- ❌ No Manufacturer reference
- ❌ No Variant information
- ❌ No Base Cost or Retail Price
- ❌ Would fail on import due to missing FK relationships

#### ✅ What's Included Now (After):

**Product Master Fields:**
```csv
Product Code*, Product Name*, Product Description, Brand Name*, Category*, 
Group*, SubGroup*, Manufacturer*, Is Vape Product*, Age Restriction
```

**Variant Fields (Default Variant):**
```csv
Variant Code*, Variant Name*, Base Cost (RM)*, Retail Price (RM)*, 
Barcode, Manufacturer SKU
```

**Total:** 16 columns covering full product + variant creation

---

### 2. **Inventory Template - Schema Alignment**

#### ❌ Before:
```
Variant Code, Location Code, Quantity, Unit Cost, Bin Location, Reorder Point, Reorder Quantity
```

#### ✅ After:
```
Variant Code*, Location Code*, Quantity On Hand*, Average Cost (RM), 
Bin Location, Reorder Point, Reorder Quantity, Max Stock Level
```

**Key Changes:**
- Renamed `Quantity` → `Quantity On Hand` (matches DB schema)
- Renamed `Unit Cost` → `Average Cost (RM)` (matches DB field)
- Added `Max Stock Level` field
- Updated examples to match real variant codes format

---

## 📊 Database Relationship Map

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRODUCT MASTER DATA                          │
│                    (Must exist FIRST)                           │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼─────┐         ┌────▼─────┐         ┌────▼─────┐
   │  Brands  │         │Categories│         │Manufacturers│
   └────┬─────┘         └────┬─────┘         └────┬─────┘
        │                    │                     │
        │              ┌─────▼─────┐              │
        │              │  Groups   │              │
        │              └─────┬─────┘              │
        │              ┌─────▼─────┐              │
        │              │ SubGroups │              │
        │              └───────────┘              │
        │                                         │
        └─────────────────┬───────────────────────┘
                          │
              ┌───────────▼───────────┐
              │      PRODUCTS         │ ◄── Migration Template Row
              │  (products table)     │
              └───────────┬───────────┘
                          │
                          │ has many
                          │
              ┌───────────▼───────────┐
              │  PRODUCT VARIANTS     │ ◄── Included in same template!
              │(product_variants)     │
              └───────────┬───────────┘
                          │
                          │ tracked in
                          │
              ┌───────────▼───────────┐
              │ PRODUCT INVENTORY     │ ◄── Separate Inventory Template
              │(product_inventory)    │
              └───────────────────────┘
```

---

## 🔄 Template Structure Details

### **Product Template Columns**

| # | Column Name | Type | Required | Example | DB Mapping |
|---|-------------|------|----------|---------|------------|
| 1 | Product Code* | Text | Auto-gen | `PRD001` | `products.product_code` |
| 2 | Product Name* | Text | ✅ Yes | `Vape Device Premium` | `products.product_name` |
| 3 | Product Description | Text | No | `High-quality device...` | `products.product_description` |
| 4 | Brand Name* | Text | ✅ Yes | `VapeTech` | `products.brand_id` (FK) |
| 5 | Category* | Text | ✅ Yes | `Electronics` | `products.category_id` (FK) |
| 6 | Group* | Text | ✅ Yes | `Vaping Devices` | `products.group_id` (FK) |
| 7 | SubGroup* | Text | ✅ Yes | `Premium Devices` | `products.subgroup_id` (FK) |
| 8 | Manufacturer* | Text | ✅ Yes | `TechFactory Ltd` | `products.manufacturer_id` (FK) |
| 9 | Is Vape Product* | Yes/No | ✅ Yes | `Yes` | `products.is_vape` |
| 10 | Age Restriction | Number | No | `18` | `products.age_restriction` |
| 11 | Variant Code* | Text | Auto-gen | `VAR-PRD001-01` | `product_variants.variant_code` |
| 12 | Variant Name* | Text | ✅ Yes | `Black 2000mAh` | `product_variants.variant_name` |
| 13 | Base Cost (RM)* | Decimal | ✅ Yes | `85.50` | `product_variants.base_cost` |
| 14 | Retail Price (RM)* | Decimal | ✅ Yes | `150.00` | `product_variants.suggested_retail_price` |
| 15 | Barcode | Text | No | `1234567890123` | `product_variants.barcode` |
| 16 | Manufacturer SKU | Text | Auto-gen | `MFG-12345` | `product_variants.manufacturer_sku` |

**Total Fields:** 16 (10 product fields + 6 variant fields)

---

### **Inventory Template Columns**

| # | Column Name | Type | Required | Example | DB Mapping |
|---|-------------|------|----------|---------|------------|
| 1 | Variant Code* | Text | ✅ Yes | `VAR-PRD001-01` | `product_inventory.variant_id` (FK) |
| 2 | Location Code* | Text | ✅ Yes | `WH001` | `product_inventory.organization_id` (FK) |
| 3 | Quantity On Hand* | Integer | ✅ Yes | `100` | `product_inventory.quantity_on_hand` |
| 4 | Average Cost (RM) | Decimal | Recommended | `85.50` | `product_inventory.average_cost` |
| 5 | Bin Location | Text | No | `A1-B2-C3` | `product_inventory.warehouse_location` |
| 6 | Reorder Point | Integer | No | `20` | `product_inventory.reorder_point` |
| 7 | Reorder Quantity | Integer | No | `50` | `product_inventory.reorder_quantity` |
| 8 | Max Stock Level | Integer | No | `500` | `product_inventory.max_stock_level` |

**Total Fields:** 8 (all inventory-specific)

---

## 📋 Prerequisites & Import Order

### **CRITICAL: Import Order Matters!**

```
Step 1: Master Data Setup (via Product Management UI)
├── 1.1 Create Brands
├── 1.2 Create Categories
├── 1.3 Create Groups (under Categories)
├── 1.4 Create SubGroups (under Groups)
└── 1.5 Register Manufacturer Organizations

Step 2: Product Migration
└── Import Products + Default Variants (uses Migration Template)

Step 3: Organization Migration (if needed)
└── Import Warehouses/Locations (uses Organization Template)

Step 4: Inventory Migration
└── Import Stock Levels (uses Inventory Template)
```

---

## 🚨 Common Import Errors & Solutions

### **Error 1: "Brand not found"**
```
❌ Error: Foreign key violation - brands.id does not exist
```
**Solution:** Create the brand first via Product Management → Brands tab

### **Error 2: "Group/SubGroup missing"**
```
❌ Error: Cannot insert product - group_id is required
```
**Solution:** 
1. Create Category first
2. Create Group under that Category
3. Create SubGroup under that Group
4. Use exact names in migration template

### **Error 3: "Manufacturer doesn't exist"**
```
❌ Error: manufacturer_id references non-existent organization
```
**Solution:** Register manufacturer organization first via Organizations menu

### **Error 4: "Variant code not found" (Inventory Import)**
```
❌ Error: Cannot create inventory - variant_id is NULL
```
**Solution:** 
1. Import products first (creates variants)
2. Use exact variant codes generated by system
3. Tip: Export products after import to get correct variant codes

---

## 🎨 Visual Comparison: Before vs After

### **Before Update:**
```
📄 Product Template:
┌─────────────────────────────────────┐
│ Product Code  | Sample Product     │
│ Product Name  | Sample Product     │
│ Brand         | Brand X            │
│ Category      | Electronics        │
│ Description   | Product description│
│ Is Vape       | Yes                │
│ Age           | 18                 │
└─────────────────────────────────────┘
                 ⚠️ Missing:
                 - Group/SubGroup
                 - Manufacturer
                 - Variant info
                 - Pricing
```

### **After Update:**
```
📄 Product Template (Complete):
┌─────────────────────────────────────────────────────────┐
│ PRODUCT MASTER DATA:                                    │
│ ├─ Product Code       | PRD001                          │
│ ├─ Product Name       | Vape Device Premium            │
│ ├─ Description        | High-quality vape device...     │
│ ├─ Brand Name         | VapeTech                        │
│ ├─ Category           | Electronics                     │
│ ├─ Group              | Vaping Devices           ✅ NEW │
│ ├─ SubGroup           | Premium Devices          ✅ NEW │
│ ├─ Manufacturer       | TechFactory Ltd          ✅ NEW │
│ ├─ Is Vape Product    | Yes                             │
│ └─ Age Restriction    | 18                              │
│                                                          │
│ DEFAULT VARIANT DATA:                           ✅ NEW  │
│ ├─ Variant Code       | VAR-PRD001-01                   │
│ ├─ Variant Name       | Black 2000mAh                   │
│ ├─ Base Cost (RM)     | 85.50                    ✅ NEW │
│ ├─ Retail Price (RM)  | 150.00                   ✅ NEW │
│ ├─ Barcode            | 1234567890123                   │
│ └─ Manufacturer SKU   | MFG-12345                       │
└─────────────────────────────────────────────────────────┘
                 ✅ Complete! Ready to integrate
```

---

## 💡 Best Practices

### **1. Template Workflow**
```bash
# Recommended workflow for new data:

1. Download template from Migration page
2. Fill in data using examples as guide
3. Keep master data names EXACT (case-sensitive)
4. Leave auto-generated fields empty (codes, SKUs)
5. Test with 5-10 rows first
6. Validate import results
7. Import full dataset
```

### **2. Master Data Naming**
```
✅ GOOD - Use exact system names:
  Brand: "VapeTech"
  Category: "Electronics" 
  Group: "Vaping Devices"
  SubGroup: "Premium Devices"

❌ BAD - Variations will fail:
  Brand: "vapetech" (lowercase)
  Category: "Electronic" (singular)
  Group: "Vaping Device" (missing 's')
```

### **3. Pricing Strategy**
```
Base Cost = Your actual cost from manufacturer
Retail Price = Suggested selling price

Example:
├─ Base Cost: RM 85.50 (what you pay)
├─ Retail Price: RM 150.00 (what you suggest)
└─ Margin: RM 64.50 (75% markup)
```

---

## 📁 File Locations

```
/app/src/components/migration/
└── MigrationView.tsx ..................... Updated component (16 columns)

Generated Templates:
├── product_masterdata_template.csv ....... Product + Variant (16 cols)
├── inventory_stock_template.csv .......... Inventory (8 cols)
└── organizations_*.csv ................... Organization templates
```

---

## 🔍 Testing Checklist

- [x] Product template includes all 16 columns
- [x] Inventory template uses correct field names
- [x] Warning alerts show prerequisites
- [x] Download generates 2 example rows
- [x] CSV format is valid
- [ ] Backend parser implementation (TODO)
- [ ] Database insertion with FK validation (TODO)
- [ ] Error handling for missing master data (TODO)

---

## 🚀 Next Steps (Backend Implementation)

### **Phase 1: CSV Parsing**
```typescript
// Install dependencies
npm install xlsx papaparse

// Parse uploaded CSV
const parseCSV = (file: File) => {
  // Extract headers and data rows
  // Validate required fields
  // Return structured data
}
```

### **Phase 2: Data Validation**
```typescript
// Validate each row
const validateProduct = async (row: any) => {
  // Check if brand exists (by name)
  // Check if category exists (by name)
  // Check if group exists (by name + category)
  // Check if subgroup exists (by name + group)
  // Check if manufacturer exists (by name)
  // Validate data types and formats
}
```

### **Phase 3: Database Insertion**
```typescript
// Insert with transaction
const importProducts = async (validatedData: any[]) => {
  // Start transaction
  // For each row:
  //   - Create product record
  //   - Create default variant record
  //   - Link all FK relationships
  // Commit or rollback on error
}
```

---

## 📞 Support

For import issues or questions:
1. Check Prerequisites section
2. Verify master data exists
3. Review Common Errors section
4. Test with small dataset first
5. Contact system administrator

---

## 📄 Example Template Content

### **Product Template (CSV):**
```csv
Product Code*,Product Name*,Product Description,Brand Name*,Category*,Group*,SubGroup*,Manufacturer*,Is Vape Product*,Age Restriction,Variant Code*,Variant Name*,Base Cost (RM)*,Retail Price (RM)*,Barcode,Manufacturer SKU
PRD001,Vape Device Premium,High-quality vape device with advanced features,VapeTech,Electronics,Vaping Devices,Premium Devices,TechFactory Ltd,Yes,18,VAR-PRD001-01,Black 2000mAh,85.50,150.00,1234567890123,MFG-12345
,Vape Starter Kit,Complete starter kit with charger and case,VapeTech,Electronics,Vaping Devices,Starter Kits,TechFactory Ltd,Yes,21,,Silver 1500mAh,75.00,129.90,9876543210987,
```

### **Inventory Template (CSV):**
```csv
Variant Code*,Location Code*,Quantity On Hand*,Average Cost (RM),Bin Location,Reorder Point,Reorder Quantity,Max Stock Level
VAR-PRD001-01,WH001,100,85.50,A1-B2-C3,20,50,500
VAR-PRD001-01,WH002,250,75.00,B2-C3-D4,30,100,1000
```

---

**✅ Status:** Templates updated and ready for use  
**📅 Last Updated:** October 24, 2025  
**👤 Updated By:** GitHub Copilot  
**🔄 Version:** 2.0 (Complete Integration)
