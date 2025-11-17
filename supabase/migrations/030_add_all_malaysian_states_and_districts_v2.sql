-- Add all Malaysian states and districts
-- This migration adds all 13 states and 3 federal territories of Malaysia
-- along with their major districts

-- Create a temporary function to insert if not exists
CREATE OR REPLACE FUNCTION insert_state_if_not_exists(
  p_state_code VARCHAR,
  p_state_name VARCHAR
) RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM states WHERE state_code = p_state_code) THEN
    INSERT INTO states (state_code, state_name, is_active) VALUES (p_state_code, p_state_name, true);
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION insert_district_if_not_exists(
  p_district_code VARCHAR,
  p_district_name VARCHAR,
  p_state_code VARCHAR
) RETURNS VOID AS $$
DECLARE
  v_state_id UUID;
BEGIN
  SELECT id INTO v_state_id FROM states WHERE state_code = p_state_code;
  IF v_state_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM districts WHERE district_code = p_district_code) THEN
    INSERT INTO districts (district_code, district_name, state_id, is_active) 
    VALUES (p_district_code, p_district_name, v_state_id, true);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Insert all states
SELECT insert_state_if_not_exists('JHR', 'Johor');
SELECT insert_state_if_not_exists('KDH', 'Kedah');
SELECT insert_state_if_not_exists('KTN', 'Kelantan');
SELECT insert_state_if_not_exists('KUL', 'Kuala Lumpur');
SELECT insert_state_if_not_exists('LBN', 'Labuan');
SELECT insert_state_if_not_exists('MLK', 'Melaka');
SELECT insert_state_if_not_exists('NSN', 'Negeri Sembilan');
SELECT insert_state_if_not_exists('PHG', 'Pahang');
SELECT insert_state_if_not_exists('PNG', 'Penang');
SELECT insert_state_if_not_exists('PRK', 'Perak');
SELECT insert_state_if_not_exists('PLS', 'Perlis');
SELECT insert_state_if_not_exists('PJY', 'Putrajaya');
SELECT insert_state_if_not_exists('SBH', 'Sabah');
SELECT insert_state_if_not_exists('SGR', 'Selangor');
SELECT insert_state_if_not_exists('SWK', 'Sarawak');
SELECT insert_state_if_not_exists('TRG', 'Terengganu');

-- Insert all districts
-- Johor
SELECT insert_district_if_not_exists('JHR_JB', 'Johor Bahru', 'JHR');
SELECT insert_district_if_not_exists('JHR_KL', 'Kluang', 'JHR');
SELECT insert_district_if_not_exists('JHR_KT', 'Kota Tinggi', 'JHR');
SELECT insert_district_if_not_exists('JHR_KL2', 'Kulai', 'JHR');
SELECT insert_district_if_not_exists('JHR_MR', 'Mersing', 'JHR');
SELECT insert_district_if_not_exists('JHR_MU', 'Muar', 'JHR');
SELECT insert_district_if_not_exists('JHR_PK', 'Pontian', 'JHR');
SELECT insert_district_if_not_exists('JHR_SG', 'Segamat', 'JHR');
SELECT insert_district_if_not_exists('JHR_BP', 'Batu Pahat', 'JHR');
SELECT insert_district_if_not_exists('JHR_TG', 'Tangkak', 'JHR');

-- Kedah
SELECT insert_district_if_not_exists('KDH_AB', 'Alor Setar (Kota Setar)', 'KDH');
SELECT insert_district_if_not_exists('KDH_BJ', 'Baling', 'KDH');
SELECT insert_district_if_not_exists('KDH_BF', 'Bandar Baharu', 'KDH');
SELECT insert_district_if_not_exists('KDH_KB', 'Kubang Pasu', 'KDH');
SELECT insert_district_if_not_exists('KDH_KL', 'Kulim', 'KDH');
SELECT insert_district_if_not_exists('KDH_LG', 'Langkawi', 'KDH');
SELECT insert_district_if_not_exists('KDH_PD', 'Padang Terap', 'KDH');
SELECT insert_district_if_not_exists('KDH_PT', 'Pendang', 'KDH');
SELECT insert_district_if_not_exists('KDH_SY', 'Sik', 'KDH');
SELECT insert_district_if_not_exists('KDH_YN', 'Yan', 'KDH');

-- Kelantan
SELECT insert_district_if_not_exists('KTN_KB', 'Kota Bharu', 'KTN');
SELECT insert_district_if_not_exists('KTN_BC', 'Bachok', 'KTN');
SELECT insert_district_if_not_exists('KTN_GM', 'Gua Musang', 'KTN');
SELECT insert_district_if_not_exists('KTN_JL', 'Jeli', 'KTN');
SELECT insert_district_if_not_exists('KTN_KR', 'Kuala Krai', 'KTN');
SELECT insert_district_if_not_exists('KTN_MC', 'Machang', 'KTN');
SELECT insert_district_if_not_exists('KTN_PS', 'Pasir Mas', 'KTN');
SELECT insert_district_if_not_exists('KTN_PT', 'Pasir Puteh', 'KTN');
SELECT insert_district_if_not_exists('KTN_TN', 'Tanah Merah', 'KTN');
SELECT insert_district_if_not_exists('KTN_TM', 'Tumpat', 'KTN');

-- Kuala Lumpur
SELECT insert_district_if_not_exists('KUL_BN', 'Bukit Bintang', 'KUL');
SELECT insert_district_if_not_exists('KUL_CH', 'Cheras', 'KUL');
SELECT insert_district_if_not_exists('KUL_KL', 'Kepong', 'KUL');
SELECT insert_district_if_not_exists('KUL_LS', 'Lembah Pantai', 'KUL');
SELECT insert_district_if_not_exists('KUL_SB', 'Setiawangsa', 'KUL');
SELECT insert_district_if_not_exists('KUL_TT', 'Titiwangsa', 'KUL');
SELECT insert_district_if_not_exists('KUL_WP', 'Wangsa Maju', 'KUL');

-- Labuan
SELECT insert_district_if_not_exists('LBN_LB', 'Labuan', 'LBN');

-- Melaka
SELECT insert_district_if_not_exists('MLK_AT', 'Alor Gajah', 'MLK');
SELECT insert_district_if_not_exists('MLK_JN', 'Jasin', 'MLK');
SELECT insert_district_if_not_exists('MLK_MT', 'Melaka Tengah', 'MLK');

-- Negeri Sembilan
SELECT insert_district_if_not_exists('NSN_JH', 'Jempol', 'NSN');
SELECT insert_district_if_not_exists('NSN_JL', 'Jelebu', 'NSN');
SELECT insert_district_if_not_exists('NSN_KL', 'Kuala Pilah', 'NSN');
SELECT insert_district_if_not_exists('NSN_PT', 'Port Dickson', 'NSN');
SELECT insert_district_if_not_exists('NSN_RB', 'Rembau', 'NSN');
SELECT insert_district_if_not_exists('NSN_SI', 'Seremban', 'NSN');
SELECT insert_district_if_not_exists('NSN_TM', 'Tampin', 'NSN');

-- Pahang
SELECT insert_district_if_not_exists('PHG_BN', 'Bentong', 'PHG');
SELECT insert_district_if_not_exists('PHG_CM', 'Cameron Highlands', 'PHG');
SELECT insert_district_if_not_exists('PHG_JR', 'Jerantut', 'PHG');
SELECT insert_district_if_not_exists('PHG_KN', 'Kuantan', 'PHG');
SELECT insert_district_if_not_exists('PHG_LP', 'Lipis', 'PHG');
SELECT insert_district_if_not_exists('PHG_ML', 'Maran', 'PHG');
SELECT insert_district_if_not_exists('PHG_PH', 'Pekan', 'PHG');
SELECT insert_district_if_not_exists('PHG_RM', 'Raub', 'PHG');
SELECT insert_district_if_not_exists('PHG_RU', 'Rompin', 'PHG');
SELECT insert_district_if_not_exists('PHG_TM', 'Temerloh', 'PHG');
SELECT insert_district_if_not_exists('PHG_BH', 'Bera', 'PHG');

-- Penang
SELECT insert_district_if_not_exists('PNG_GT', 'George Town', 'PNG');
SELECT insert_district_if_not_exists('PNG_BD', 'Barat Daya', 'PNG');
SELECT insert_district_if_not_exists('PNG_SB', 'Seberang Perai Utara', 'PNG');
SELECT insert_district_if_not_exists('PNG_ST', 'Seberang Perai Tengah', 'PNG');
SELECT insert_district_if_not_exists('PNG_SS', 'Seberang Perai Selatan', 'PNG');

-- Perak
SELECT insert_district_if_not_exists('PRK_BG', 'Batang Padang', 'PRK');
SELECT insert_district_if_not_exists('PRK_HT', 'Hilir Perak', 'PRK');
SELECT insert_district_if_not_exists('PRK_IP', 'Ipoh', 'PRK');
SELECT insert_district_if_not_exists('PRK_KM', 'Kampar', 'PRK');
SELECT insert_district_if_not_exists('PRK_KN', 'Kinta', 'PRK');
SELECT insert_district_if_not_exists('PRK_KU', 'Kuala Kangsar', 'PRK');
SELECT insert_district_if_not_exists('PRK_KR', 'Kerian', 'PRK');
SELECT insert_district_if_not_exists('PRK_LT', 'Larut, Matang dan Selama', 'PRK');
SELECT insert_district_if_not_exists('PRK_MJ', 'Manjung', 'PRK');
SELECT insert_district_if_not_exists('PRK_MR', 'Muallim', 'PRK');
SELECT insert_district_if_not_exists('PRK_PR', 'Perak Tengah', 'PRK');
SELECT insert_district_if_not_exists('PRK_HP', 'Hulu Perak', 'PRK');

-- Perlis
SELECT insert_district_if_not_exists('PLS_KG', 'Kangar', 'PLS');
SELECT insert_district_if_not_exists('PLS_PD', 'Padang Besar', 'PLS');

-- Putrajaya
SELECT insert_district_if_not_exists('PJY_PJ', 'Putrajaya', 'PJY');

-- Sabah
SELECT insert_district_if_not_exists('SBH_BU', 'Beaufort', 'SBH');
SELECT insert_district_if_not_exists('SBH_BP', 'Beluran', 'SBH');
SELECT insert_district_if_not_exists('SBH_KK', 'Kota Kinabalu', 'SBH');
SELECT insert_district_if_not_exists('SBH_KB', 'Kota Belud', 'SBH');
SELECT insert_district_if_not_exists('SBH_KM', 'Kota Marudu', 'SBH');
SELECT insert_district_if_not_exists('SBH_KU', 'Kuala Penyu', 'SBH');
SELECT insert_district_if_not_exists('SBH_KD', 'Kudat', 'SBH');
SELECT insert_district_if_not_exists('SBH_KG', 'Kunak', 'SBH');
SELECT insert_district_if_not_exists('SBH_LH', 'Lahad Datu', 'SBH');
SELECT insert_district_if_not_exists('SBH_PN', 'Penampang', 'SBH');
SELECT insert_district_if_not_exists('SBH_PR', 'Papar', 'SBH');
SELECT insert_district_if_not_exists('SBH_RN', 'Ranau', 'SBH');
SELECT insert_district_if_not_exists('SBH_SW', 'Sandakan', 'SBH');
SELECT insert_district_if_not_exists('SBH_SM', 'Semporna', 'SBH');
SELECT insert_district_if_not_exists('SBH_SB', 'Sipitang', 'SBH');
SELECT insert_district_if_not_exists('SBH_TW', 'Tawau', 'SBH');
SELECT insert_district_if_not_exists('SBH_TN', 'Tenom', 'SBH');
SELECT insert_district_if_not_exists('SBH_TU', 'Tuaran', 'SBH');

-- Selangor
SELECT insert_district_if_not_exists('SGR_GP', 'Gombak', 'SGR');
SELECT insert_district_if_not_exists('SGR_HU', 'Hulu Langat', 'SGR');
SELECT insert_district_if_not_exists('SGR_HS', 'Hulu Selangor', 'SGR');
SELECT insert_district_if_not_exists('SGR_KL', 'Klang', 'SGR');
SELECT insert_district_if_not_exists('SGR_KS', 'Kuala Selangor', 'SGR');
SELECT insert_district_if_not_exists('SGR_KG', 'Kuala Langat', 'SGR');
SELECT insert_district_if_not_exists('SGR_PT', 'Petaling', 'SGR');
SELECT insert_district_if_not_exists('SGR_SB', 'Sabak Bernam', 'SGR');
SELECT insert_district_if_not_exists('SGR_SP', 'Sepang', 'SGR');

-- Sarawak
SELECT insert_district_if_not_exists('SWK_BT', 'Betong', 'SWK');
SELECT insert_district_if_not_exists('SWK_BN', 'Bintulu', 'SWK');
SELECT insert_district_if_not_exists('SWK_KC', 'Kuching', 'SWK');
SELECT insert_district_if_not_exists('SWK_LB', 'Limbang', 'SWK');
SELECT insert_district_if_not_exists('SWK_MR', 'Miri', 'SWK');
SELECT insert_district_if_not_exists('SWK_MK', 'Mukah', 'SWK');
SELECT insert_district_if_not_exists('SWK_SA', 'Samarahan', 'SWK');
SELECT insert_district_if_not_exists('SWK_SB', 'Sarikei', 'SWK');
SELECT insert_district_if_not_exists('SWK_SR', 'Serian', 'SWK');
SELECT insert_district_if_not_exists('SWK_SI', 'Sibu', 'SWK');
SELECT insert_district_if_not_exists('SWK_KS', 'Kapit', 'SWK');
SELECT insert_district_if_not_exists('SWK_SM', 'Sri Aman', 'SWK');

-- Terengganu
SELECT insert_district_if_not_exists('TRG_BS', 'Besut', 'TRG');
SELECT insert_district_if_not_exists('TRG_DN', 'Dungun', 'TRG');
SELECT insert_district_if_not_exists('TRG_HU', 'Hulu Terengganu', 'TRG');
SELECT insert_district_if_not_exists('TRG_KT', 'Kemaman', 'TRG');
SELECT insert_district_if_not_exists('TRG_KU', 'Kuala Terengganu', 'TRG');
SELECT insert_district_if_not_exists('TRG_KN', 'Kuala Nerus', 'TRG');
SELECT insert_district_if_not_exists('TRG_MR', 'Marang', 'TRG');
SELECT insert_district_if_not_exists('TRG_ST', 'Setiu', 'TRG');

-- Clean up temporary functions
DROP FUNCTION IF EXISTS insert_state_if_not_exists(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS insert_district_if_not_exists(VARCHAR, VARCHAR, VARCHAR);
