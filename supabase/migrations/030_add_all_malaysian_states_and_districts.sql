-- Add all Malaysian states and districts
-- This migration adds all 13 states and 3 federal territories of Malaysia
-- along with their major districts

-- First, ensure we have all states
INSERT INTO states (state_code, state_name, is_active) VALUES
  ('JHR', 'Johor', true),
  ('KDH', 'Kedah', true),
  ('KTN', 'Kelantan', true),
  ('KUL', 'Kuala Lumpur', true),
  ('LBN', 'Labuan', true),
  ('MLK', 'Melaka', true),
  ('NSN', 'Negeri Sembilan', true),
  ('PHG', 'Pahang', true),
  ('PNG', 'Penang', true),
  ('PRK', 'Perak', true),
  ('PLS', 'Perlis', true),
  ('PJY', 'Putrajaya', true),
  ('SBH', 'Sabah', true),
  ('SGR', 'Selangor', true),
  ('SWK', 'Sarawak', true),
  ('TRG', 'Terengganu', true)
ON CONFLICT (state_code) DO UPDATE SET
  state_name = EXCLUDED.state_name,
  is_active = EXCLUDED.is_active;

-- Add districts for each state
-- Johor districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'JHR_JB', 'Johor Bahru', id, true FROM states WHERE state_code = 'JHR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'JHR_KL', 'Kluang', id, true FROM states WHERE state_code = 'JHR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'JHR_KT', 'Kota Tinggi', id, true FROM states WHERE state_code = 'JHR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'JHR_KL2', 'Kulai', id, true FROM states WHERE state_code = 'JHR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'JHR_MR', 'Mersing', id, true FROM states WHERE state_code = 'JHR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'JHR_MU', 'Muar', id, true FROM states WHERE state_code = 'JHR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'JHR_PK', 'Pontian', id, true FROM states WHERE state_code = 'JHR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'JHR_SG', 'Segamat', id, true FROM states WHERE state_code = 'JHR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'JHR_BP', 'Batu Pahat', id, true FROM states WHERE state_code = 'JHR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'JHR_TG', 'Tangkak', id, true FROM states WHERE state_code = 'JHR'
ON CONFLICT (district_code) DO NOTHING;

-- Kedah districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KDH_AB', 'Alor Setar (Kota Setar)', id, true FROM states WHERE state_code = 'KDH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KDH_BJ', 'Baling', id, true FROM states WHERE state_code = 'KDH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KDH_BF', 'Bandar Baharu', id, true FROM states WHERE state_code = 'KDH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KDH_KB', 'Kubang Pasu', id, true FROM states WHERE state_code = 'KDH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KDH_KL', 'Kulim', id, true FROM states WHERE state_code = 'KDH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KDH_LG', 'Langkawi', id, true FROM states WHERE state_code = 'KDH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KDH_PD', 'Padang Terap', id, true FROM states WHERE state_code = 'KDH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KDH_PT', 'Pendang', id, true FROM states WHERE state_code = 'KDH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KDH_SY', 'Sik', id, true FROM states WHERE state_code = 'KDH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KDH_YN', 'Yan', id, true FROM states WHERE state_code = 'KDH'
ON CONFLICT (district_code) DO NOTHING;

-- Kelantan districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KTN_KB', 'Kota Bharu', id, true FROM states WHERE state_code = 'KTN'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KTN_BC', 'Bachok', id, true FROM states WHERE state_code = 'KTN'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KTN_GM', 'Gua Musang', id, true FROM states WHERE state_code = 'KTN'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KTN_JL', 'Jeli', id, true FROM states WHERE state_code = 'KTN'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KTN_KR', 'Kuala Krai', id, true FROM states WHERE state_code = 'KTN'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KTN_MC', 'Machang', id, true FROM states WHERE state_code = 'KTN'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KTN_PS', 'Pasir Mas', id, true FROM states WHERE state_code = 'KTN'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KTN_PT', 'Pasir Puteh', id, true FROM states WHERE state_code = 'KTN'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KTN_TN', 'Tanah Merah', id, true FROM states WHERE state_code = 'KTN'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KTN_TM', 'Tumpat', id, true FROM states WHERE state_code = 'KTN'
ON CONFLICT (district_code) DO NOTHING;

-- Kuala Lumpur districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KUL_BN', 'Bukit Bintang', id, true FROM states WHERE state_code = 'KUL'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KUL_CH', 'Cheras', id, true FROM states WHERE state_code = 'KUL'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KUL_KL', 'Kepong', id, true FROM states WHERE state_code = 'KUL'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KUL_LS', 'Lembah Pantai', id, true FROM states WHERE state_code = 'KUL'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KUL_SB', 'Setiawangsa', id, true FROM states WHERE state_code = 'KUL'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KUL_TT', 'Titiwangsa', id, true FROM states WHERE state_code = 'KUL'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'KUL_WP', 'Wangsa Maju', id, true FROM states WHERE state_code = 'KUL'
ON CONFLICT (district_code) DO NOTHING;

-- Labuan districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'LBN_LB', 'Labuan', id, true FROM states WHERE state_code = 'LBN'
ON CONFLICT (district_code) DO NOTHING;

-- Melaka districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'MLK_AT', 'Alor Gajah', id, true FROM states WHERE state_code = 'MLK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'MLK_JN', 'Jasin', id, true FROM states WHERE state_code = 'MLK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'MLK_MT', 'Melaka Tengah', id, true FROM states WHERE state_code = 'MLK'
ON CONFLICT (district_code) DO NOTHING;

-- Negeri Sembilan districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'NSN_JH', 'Jempol', id, true FROM states WHERE state_code = 'NSN'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'NSN_JL', 'Jelebu', id, true FROM states WHERE state_code = 'NSN'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'NSN_KL', 'Kuala Pilah', id, true FROM states WHERE state_code = 'NSN'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'NSN_PT', 'Port Dickson', id, true FROM states WHERE state_code = 'NSN'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'NSN_RB', 'Rembau', id, true FROM states WHERE state_code = 'NSN'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'NSN_SI', 'Seremban', id, true FROM states WHERE state_code = 'NSN'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'NSN_TM', 'Tampin', id, true FROM states WHERE state_code = 'NSN'
ON CONFLICT (district_code) DO NOTHING;

-- Pahang districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PHG_BN', 'Bentong', id, true FROM states WHERE state_code = 'PHG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PHG_CM', 'Cameron Highlands', id, true FROM states WHERE state_code = 'PHG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PHG_JR', 'Jerantut', id, true FROM states WHERE state_code = 'PHG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PHG_KN', 'Kuantan', id, true FROM states WHERE state_code = 'PHG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PHG_LP', 'Lipis', id, true FROM states WHERE state_code = 'PHG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PHG_ML', 'Maran', id, true FROM states WHERE state_code = 'PHG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PHG_PH', 'Pekan', id, true FROM states WHERE state_code = 'PHG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PHG_RM', 'Raub', id, true FROM states WHERE state_code = 'PHG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PHG_RU', 'Rompin', id, true FROM states WHERE state_code = 'PHG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PHG_TM', 'Temerloh', id, true FROM states WHERE state_code = 'PHG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PHG_BH', 'Bera', id, true FROM states WHERE state_code = 'PHG'
ON CONFLICT (district_code) DO NOTHING;

-- Penang districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PNG_GT', 'George Town', id, true FROM states WHERE state_code = 'PNG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PNG_BD', 'Barat Daya', id, true FROM states WHERE state_code = 'PNG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PNG_SB', 'Seberang Perai Utara', id, true FROM states WHERE state_code = 'PNG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PNG_ST', 'Seberang Perai Tengah', id, true FROM states WHERE state_code = 'PNG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PNG_SS', 'Seberang Perai Selatan', id, true FROM states WHERE state_code = 'PNG'
ON CONFLICT (district_code) DO NOTHING;

-- Perak districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PRK_BG', 'Batang Padang', id, true FROM states WHERE state_code = 'PRK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PRK_HT', 'Hilir Perak', id, true FROM states WHERE state_code = 'PRK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PRK_IP', 'Ipoh', id, true FROM states WHERE state_code = 'PRK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PRK_KM', 'Kampar', id, true FROM states WHERE state_code = 'PRK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PRK_KN', 'Kinta', id, true FROM states WHERE state_code = 'PRK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PRK_KU', 'Kuala Kangsar', id, true FROM states WHERE state_code = 'PRK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PRK_KR', 'Kerian', id, true FROM states WHERE state_code = 'PRK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PRK_LT', 'Larut, Matang dan Selama', id, true FROM states WHERE state_code = 'PRK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PRK_MJ', 'Manjung', id, true FROM states WHERE state_code = 'PRK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PRK_MR', 'Muallim', id, true FROM states WHERE state_code = 'PRK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PRK_PR', 'Perak Tengah', id, true FROM states WHERE state_code = 'PRK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PRK_HP', 'Hulu Perak', id, true FROM states WHERE state_code = 'PRK'
ON CONFLICT (district_code) DO NOTHING;

-- Perlis districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PLS_KG', 'Kangar', id, true FROM states WHERE state_code = 'PLS'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PLS_PD', 'Padang Besar', id, true FROM states WHERE state_code = 'PLS'
ON CONFLICT (district_code) DO NOTHING;

-- Putrajaya districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'PJY_PJ', 'Putrajaya', id, true FROM states WHERE state_code = 'PJY'
ON CONFLICT (district_code) DO NOTHING;

-- Sabah districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_BU', 'Beaufort', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_BP', 'Beluran', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_KK', 'Kota Kinabalu', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_KB', 'Kota Belud', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_KM', 'Kota Marudu', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_KU', 'Kuala Penyu', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_KD', 'Kudat', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_KG', 'Kunak', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_LH', 'Lahad Datu', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_PN', 'Penampang', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_PR', 'Papar', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_RN', 'Ranau', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_SW', 'Sandakan', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_SM', 'Semporna', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_SB', 'Sipitang', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_TW', 'Tawau', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_TN', 'Tenom', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SBH_TU', 'Tuaran', id, true FROM states WHERE state_code = 'SBH'
ON CONFLICT (district_code) DO NOTHING;

-- Selangor districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SGR_GP', 'Gombak', id, true FROM states WHERE state_code = 'SGR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SGR_HU', 'Hulu Langat', id, true FROM states WHERE state_code = 'SGR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SGR_HS', 'Hulu Selangor', id, true FROM states WHERE state_code = 'SGR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SGR_KL', 'Klang', id, true FROM states WHERE state_code = 'SGR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SGR_KS', 'Kuala Selangor', id, true FROM states WHERE state_code = 'SGR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SGR_KG', 'Kuala Langat', id, true FROM states WHERE state_code = 'SGR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SGR_PT', 'Petaling', id, true FROM states WHERE state_code = 'SGR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SGR_SB', 'Sabak Bernam', id, true FROM states WHERE state_code = 'SGR'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SGR_SP', 'Sepang', id, true FROM states WHERE state_code = 'SGR'
ON CONFLICT (district_code) DO NOTHING;

-- Sarawak districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SWK_BT', 'Betong', id, true FROM states WHERE state_code = 'SWK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SWK_BN', 'Bintulu', id, true FROM states WHERE state_code = 'SWK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SWK_KC', 'Kuching', id, true FROM states WHERE state_code = 'SWK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SWK_LB', 'Limbang', id, true FROM states WHERE state_code = 'SWK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SWK_MR', 'Miri', id, true FROM states WHERE state_code = 'SWK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SWK_MK', 'Mukah', id, true FROM states WHERE state_code = 'SWK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SWK_SA', 'Samarahan', id, true FROM states WHERE state_code = 'SWK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SWK_SB', 'Sarikei', id, true FROM states WHERE state_code = 'SWK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SWK_SR', 'Serian', id, true FROM states WHERE state_code = 'SWK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SWK_SI', 'Sibu', id, true FROM states WHERE state_code = 'SWK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SWK_KS', 'Kapit', id, true FROM states WHERE state_code = 'SWK'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'SWK_SM', 'Sri Aman', id, true FROM states WHERE state_code = 'SWK'
ON CONFLICT (district_code) DO NOTHING;

-- Terengganu districts
INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'TRG_BS', 'Besut', id, true FROM states WHERE state_code = 'TRG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'TRG_DN', 'Dungun', id, true FROM states WHERE state_code = 'TRG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'TRG_HU', 'Hulu Terengganu', id, true FROM states WHERE state_code = 'TRG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'TRG_KT', 'Kemaman', id, true FROM states WHERE state_code = 'TRG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'TRG_KU', 'Kuala Terengganu', id, true FROM states WHERE state_code = 'TRG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'TRG_KN', 'Kuala Nerus', id, true FROM states WHERE state_code = 'TRG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'TRG_MR', 'Marang', id, true FROM states WHERE state_code = 'TRG'
ON CONFLICT (district_code) DO NOTHING;

INSERT INTO districts (district_code, district_name, state_id, is_active)
SELECT 'TRG_ST', 'Setiu', id, true FROM states WHERE state_code = 'TRG'
ON CONFLICT (district_code) DO NOTHING;
