-- Migration: Manual Supplier Verification with Required Documents
-- Adds document categories and verification notes for manual business admin review

-- Add document category to track required vs optional documents
ALTER TABLE supplier_documents 
ADD COLUMN IF NOT EXISTS document_category VARCHAR(50) DEFAULT 'optional'
CHECK (document_category IN ('required', 'optional'));

-- Add verification notes for business admin
ALTER TABLE supplier_documents 
ADD COLUMN IF NOT EXISTS verification_notes TEXT;

-- Add overall verification notes to suppliers
ALTER TABLE suppliers 
ADD COLUMN IF NOT EXISTS verification_notes TEXT;

-- Add verification method tracking
ALTER TABLE suppliers 
ADD COLUMN IF NOT EXISTS verification_method VARCHAR(20) DEFAULT 'manual'
CHECK (verification_method IN ('manual', 'automated'));

-- Create a table to track required document types for Zambian suppliers
CREATE TABLE IF NOT EXISTS required_document_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_type VARCHAR(50) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0
);

-- Insert required Zambian supplier document types
INSERT INTO required_document_types (document_type, display_name, description, sort_order) VALUES
    ('pacra_certificate', 'PACRA Certificate', 'Certificate of Incorporation from Patents and Companies Registration Authority', 1),
    ('zra_tpin', 'ZRA TPIN Certificate', 'Taxpayer Identification Number certificate from Zambia Revenue Authority', 2),
    ('zra_tax_clearance', 'ZRA Tax Clearance', 'Tax clearance certificate from Zambia Revenue Authority', 3),
    ('business_license', 'Business License', 'License from local municipal authority', 4),
    ('directors_id', 'Directors ID Copies', 'Copies of ID documents for company directors', 5),
    ('bank_reference', 'Bank Reference Letter', 'Reference letter from the company bank', 6)
ON CONFLICT (document_type) DO NOTHING;

-- Create index for document category queries
CREATE INDEX IF NOT EXISTS idx_supplier_documents_category 
ON supplier_documents(supplier_id, document_category);

-- Create index for required document types
CREATE INDEX IF NOT EXISTS idx_required_document_types_active 
ON required_document_types(is_active, sort_order);