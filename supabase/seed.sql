-- ============================================================================
-- Uy-Laurio Legal Portal — Seed Data for Testing
-- ============================================================================
-- NOTE: In Supabase, creating an auth user triggers the creation of a profile 
-- via the `on_auth_user_created` trigger defined in 0001_initial_schema.sql.
-- ============================================================================

-- 1. AUTH USERS (Automatically creates profiles)
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@uy-laurio.ph', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"System Admin", "phone":"09000000000"}', now(), now()),
('00000000-0000-0000-0000-000000000000', 'c1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'client1@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Juan Dela Cruz", "phone":"09171234567"}', now(), now()),
('00000000-0000-0000-0000-000000000000', 'c2222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'client2@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Maria Clara", "phone":"09181234567"}', now(), now())
ON CONFLICT (id) DO NOTHING;

-- 2. UPDATE ROLES (Make the first user an admin)
UPDATE public.profiles SET role = 'admin' WHERE id = 'a0000000-0000-0000-0000-000000000000';

-- 3. CASES
INSERT INTO public.cases (id, client_id, module, module_detail, status, phase) VALUES
('ca5e0000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 'notarization', 'Deed of Absolute Sale Notarization', 'pending', 'Submitted'),
('ca5e0000-0000-0000-0000-000000000002', 'c2222222-2222-2222-2222-222222222222', 'ejs', 'Extrajudicial Settlement with Sale', 'progress', 'In Progress')
ON CONFLICT (id) DO NOTHING;

-- 4. DOCUMENTS
INSERT INTO public.documents (id, case_id, owner_id, name, storage_path, size_bytes, mime_type, status) VALUES
('d0c00000-0000-0000-0000-000000000001', 'ca5e0000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 'deed_of_sale.pdf', 'c1111111-1111-1111-1111-111111111111/deed_of_sale.pdf', 102400, 'application/pdf', 'pending'),
('d0c00000-0000-0000-0000-000000000002', 'ca5e0000-0000-0000-0000-000000000002', 'c2222222-2222-2222-2222-222222222222', 'birth_certificate.jpg', 'c2222222-2222-2222-2222-222222222222/birth_certificate.jpg', 204800, 'image/jpeg', 'progress')
ON CONFLICT (id) DO NOTHING;

-- 5. CASE REQUIREMENTS
INSERT INTO public.case_requirements (case_id, name, note, urgent, fulfilled, document_id, sort_order) VALUES
('ca5e0000-0000-0000-0000-000000000001', 'Valid ID (Seller)', 'Please provide a government-issued ID of the seller.', true, false, null, 1),
('ca5e0000-0000-0000-0000-000000000001', 'Draft Deed of Sale', 'Upload the drafted deed for our review.', false, true, 'd0c00000-0000-0000-0000-000000000001', 2),
('ca5e0000-0000-0000-0000-000000000002', 'Death Certificate', 'Certified true copy of the death certificate is required.', true, false, null, 1),
('ca5e0000-0000-0000-0000-000000000002', 'Birth Certificate (Heir)', 'Please provide a clear copy of the birth certificate.', false, true, 'd0c00000-0000-0000-0000-000000000002', 2);

-- 6. APPOINTMENTS
-- Generating appointments for a few days in the future
INSERT INTO public.appointments (client_id, appointment_date, time_slot, status) VALUES
('c1111111-1111-1111-1111-111111111111', current_date + interval '2 days', '10:00 AM', 'booked'),
('c2222222-2222-2222-2222-222222222222', current_date + interval '4 days', '02:00 PM', 'booked')
ON CONFLICT (appointment_date, time_slot) DO NOTHING;

-- 7. SCHEDULE OVERRIDES
INSERT INTO public.schedule_overrides (override_date, type, open_time, close_time, created_by) VALUES
(current_date + interval '5 days', 'closed', null, null, 'a0000000-0000-0000-0000-000000000000'),
(current_date + interval '6 days', 'halfday', null, null, 'a0000000-0000-0000-0000-000000000000'),
(current_date + interval '7 days', 'custom', '10:00', '15:00', 'a0000000-0000-0000-0000-000000000000')
ON CONFLICT (override_date) DO NOTHING;

-- 8. NOTIFICATIONS
INSERT INTO public.notifications (case_id, recipient, channel, message, status, created_by) VALUES
('ca5e0000-0000-0000-0000-000000000001', 'client1@example.com', 'email', 'Your case for Notarization has been received. We will notify you once review begins.', 'confirmed', 'a0000000-0000-0000-0000-000000000000'),
('ca5e0000-0000-0000-0000-000000000002', '09181234567', 'sms', 'Urgent: Please upload the pending Death Certificate for your EJS case.', 'pending', 'a0000000-0000-0000-0000-000000000000');
