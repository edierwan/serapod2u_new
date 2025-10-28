/**
 * Document Acknowledgement Service
 * Handles the complete flow of acknowledging documents with digital signatures
 */

import { createClient } from '@/lib/supabase/server';
import { generateSignedPDF, uploadSignedPDF, type DocumentSignature } from '@/lib/pdf/document-generator';

export interface AcknowledgeDocumentParams {
  documentId: string;
  userId: string;
  userRole: string;
  paymentProofUrl?: string; // For payment documents
}

export interface AcknowledgeDocumentResponse {
  success: boolean;
  documentId: string;
  documentStatus: string;
  signedPdfUrl?: string;
  signaturesCount: number;
  error?: string;
}

/**
 * Main function to acknowledge a document with digital signature
 */
export async function acknowledgeDocument(
  params: AcknowledgeDocumentParams
): Promise<AcknowledgeDocumentResponse> {
  const { documentId, userId, userRole, paymentProofUrl } = params;

  try {
    const supabase = await createClient();

    // 1. Fetch the document
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      return {
        success: false,
        documentId,
        documentStatus: 'error',
        signaturesCount: 0,
        error: 'Document not found',
      };
    }

    // 2. Validate document status
    if (document.status !== 'pending') {
      return {
        success: false,
        documentId,
        documentStatus: document.status,
        signaturesCount: 0,
        error: `Document must be pending to acknowledge (current status: ${document.status})`,
      };
    }

    // 3. Check if payment proof is required (for invoices)
    if (document.doc_type === 'INVOICE' && !paymentProofUrl) {
      const { data: settings } = await supabase
        .from('org_notification_settings')
        .select('settings')
        .eq('org_id', document.company_id)
        .single();

      const requirePaymentProof = settings?.settings?.require_payment_proof ?? false;
      
      if (requirePaymentProof) {
        return {
          success: false,
          documentId,
          documentStatus: document.status,
          signaturesCount: 0,
          error: 'Payment proof is required for this organization',
        };
      }
    }

    // 4. Add digital signature
    const { data: signature, error: sigError } = await supabase.rpc('add_document_signature', {
      p_document_id: documentId,
      p_signer_user_id: userId,
      p_signer_role: userRole,
    });

    if (sigError) {
      console.error('Error adding signature:', sigError);
      return {
        success: false,
        documentId,
        documentStatus: document.status,
        signaturesCount: 0,
        error: `Failed to add signature: ${sigError.message}`,
      };
    }

    // 5. Update document status
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        status: 'acknowledged',
        acknowledged_by: userId,
        acknowledged_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    if (updateError) {
      console.error('Error updating document:', updateError);
      return {
        success: false,
        documentId,
        documentStatus: document.status,
        signaturesCount: 0,
        error: `Failed to update document: ${updateError.message}`,
      };
    }

    // 6. Create follow-up document if needed (e.g., INVOICE -> PAYMENT)
    if (document.doc_type === 'INVOICE') {
      await createPaymentDocument(supabase, document, userId, paymentProofUrl);
    }

    // 7. Fetch all signatures for this document
    const { data: allSignatures, error: sigFetchError } = await supabase.rpc('get_document_signatures', {
      p_document_id: documentId,
    });

    if (sigFetchError) {
      console.error('Error fetching signatures:', sigFetchError);
    }

    // 8. Generate signed PDF with all signatures
    const pdfUrl = await generateAndUploadSignedPDF(
      supabase,
      documentId,
      document,
      allSignatures || []
    );

    // 9. Update document with signed PDF URL
    if (pdfUrl) {
      await supabase
        .from('documents')
        .update({ signed_pdf_url: pdfUrl })
        .eq('id', documentId);
    }

    return {
      success: true,
      documentId,
      documentStatus: 'acknowledged',
      signedPdfUrl: pdfUrl,
      signaturesCount: allSignatures?.length || 1,
    };
  } catch (error) {
    console.error('Error in acknowledgeDocument:', error);
    return {
      success: false,
      documentId,
      documentStatus: 'error',
      signaturesCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Generate and upload signed PDF for a document
 */
async function generateAndUploadSignedPDF(
  supabase: any,
  documentId: string,
  document: any,
  signatures: DocumentSignature[]
): Promise<string | undefined> {
  try {
    // Fetch order data
    const { data: order } = await supabase
      .from('orders')
      .select(
        `
        id,
        order_no,
        order_type,
        total_amount,
        order_items (
          product:products (
            product_code,
            product_name
          ),
          variant:product_variants (
            variant_name
          ),
          qty,
          unit_price,
          line_total
        )
      `
      )
      .eq('id', document.order_id)
      .single();

    if (!order) {
      console.error('Order not found for document');
      return undefined;
    }

    // Fetch organization details
    const { data: issuedBy } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', document.issued_by_org_id)
      .single();

    const { data: issuedTo } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', document.issued_to_org_id)
      .single();

    if (!issuedBy || !issuedTo) {
      console.error('Organization details not found');
      return undefined;
    }

    // Format order items
    const formattedItems = order.order_items?.map((item: any) => ({
      product_code: item.product?.product_code || '',
      product_name: item.product?.product_name || '',
      variant_name: item.variant?.variant_name || '',
      qty: item.qty,
      unit_price: item.unit_price,
      line_total: item.line_total,
    })) || [];

    // Generate PDF
    const pdfBuffer = await generateSignedPDF(
      document,
      {
        id: order.id,
        order_no: order.order_no,
        order_type: order.order_type,
        total_amount: order.total_amount,
        items: formattedItems,
      },
      issuedBy,
      issuedTo,
      signatures
    );

    // Upload to storage
    const pdfUrl = await uploadSignedPDF(
      supabase,
      pdfBuffer,
      document.doc_type,
      documentId
    );

    return pdfUrl;
  } catch (error) {
    console.error('Error generating/uploading PDF:', error);
    return undefined;
  }
}

/**
 * Create a payment document after invoice acknowledgement
 */
async function createPaymentDocument(
  supabase: any,
  invoice: any,
  userId: string,
  paymentProofUrl?: string
): Promise<void> {
  try {
    // Get order details for document number generation
    const { data: order } = await supabase
      .from('orders')
      .select('order_type, company_id, buyer_org_id, seller_org_id')
      .eq('id', invoice.order_id)
      .single();

    if (!order) return;

    // Generate payment document number
    const { data: docNo } = await supabase.rpc('generate_doc_number', {
      p_company_id: order.company_id,
      p_prefix: 'PAY',
      p_order_type: order.order_type.replace('2', ''),
    });

    // Create payment document
    const { data: payment, error: paymentError } = await supabase
      .from('documents')
      .insert({
        order_id: invoice.order_id,
        doc_type: 'PAYMENT',
        doc_no: docNo,
        status: 'pending',
        issued_by_org_id: order.buyer_org_id, // Buyer issues payment
        issued_to_org_id: order.seller_org_id,
        company_id: order.company_id,
        created_by: userId,
        payload: {
          invoice_id: invoice.id,
          invoice_no: invoice.doc_no,
        },
      })
      .select()
      .single();

    if (paymentError) {
      console.error('Error creating payment document:', paymentError);
      return;
    }

    // If payment proof was provided, attach it
    if (paymentProofUrl && payment) {
      await supabase.from('document_files').insert({
        document_id: payment.id,
        file_url: paymentProofUrl,
        company_id: order.company_id,
        uploaded_by: userId,
      });
    }
  } catch (error) {
    console.error('Error creating payment document:', error);
  }
}

/**
 * Get document with signatures
 */
export async function getDocumentWithSignatures(documentId: string) {
  const supabase = await createClient();

  const { data: document, error: docError } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single();

  if (docError || !document) {
    return { document: null, signatures: [], error: 'Document not found' };
  }

  const { data: signatures, error: sigError } = await supabase.rpc('get_document_signatures', {
    p_document_id: documentId,
  });

  if (sigError) {
    console.error('Error fetching signatures:', sigError);
  }

  return {
    document,
    signatures: signatures || [],
    error: null,
  };
}
