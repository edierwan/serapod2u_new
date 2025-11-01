// Test hash removal logic
const testCodes = [
  "http://www.serapod2u.com/track/master/MASTER-ORD-HM-1125-01-CASE-001-c03d54e4ec7d",
  "http://www.serapod2u.com/track/product/PROD-TREFL4498-GRA-209892-ORD-HM-1125-01-00101-ca1905681e4b",
  "http://www.serapod2u.com/track/product/PROD-TREFL4498-GRA-209892-ORD-HM-1125-01-00102-c976240ab29b"
];

console.log("Testing hash removal logic...\n");

testCodes.forEach(code => {
  console.log(`\nOriginal URL: ${code}`);
  
  // Test master extraction with hash removal
  if (code.includes('master/')) {
    let extracted = code.split('master/')[1];
    console.log(`  Extracted with hash: ${extracted}`);
    
    const parts = extracted.split('-');
    if (parts.length > 6) {
      extracted = parts.slice(0, -1).join('-');
    }
    console.log(`  ✅ Without hash: ${extracted}`);
  }
  
  // Test unique extraction with hash removal
  if (code.includes('product/')) {
    let extracted = code.split('product/')[1];
    console.log(`  Extracted with hash: ${extracted}`);
    
    const parts = extracted.split('-');
    if (parts.length > 7) {
      extracted = parts.slice(0, -1).join('-');
    }
    console.log(`  ✅ Without hash: ${extracted}`);
  }
});

console.log("\n\nExpected database values (without hash):");
console.log("Master: MASTER-ORD-HM-1125-01-CASE-001");
console.log("Unique: PROD-TREFL4498-GRA-209892-ORD-HM-1125-01-00101");
console.log("Unique: PROD-TREFL4498-GRA-209892-ORD-HM-1125-01-00102");

console.log("\n\n✅ These values should match what's in the database!");
