// Test script to verify code extraction logic
const testCodes = [
  "http://www.serapod2u.com/track/master/MASTER-ORD-HM-1125-01-CASE-001-c03d54e4ec7d",
  "http://www.serapod2u.com/track/product/PROD-TREFL4498-GRA-209892-ORD-HM-1125-01-00101-ca1905681e4b",
  "http://www.serapod2u.com/track/product/PROD-TREFL4498-GRA-209892-ORD-HM-1125-01-00102-c976240ab29b"
];

console.log("Testing code extraction...\n");

testCodes.forEach(code => {
  console.log(`\nOriginal: ${code}`);
  
  // Test master extraction
  if (code.includes('master/')) {
    const extracted = code.split('master/')[1];
    console.log(`  Master code extracted: ${extracted}`);
  }
  
  // Test unique extraction  
  if (code.includes('product/')) {
    const extracted = code.split('product/')[1];
    console.log(`  Unique code extracted: ${extracted}`);
  }
});

console.log("\n\nExpected results:");
console.log("Master: MASTER-ORD-HM-1125-01-CASE-001-c03d54e4ec7d");
console.log("Unique: PROD-TREFL4498-GRA-209892-ORD-HM-1125-01-00101-ca1905681e4b");
console.log("Unique: PROD-TREFL4498-GRA-209892-ORD-HM-1125-01-00102-c976240ab29b");
