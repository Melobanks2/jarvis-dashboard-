const axios = require('axios');

const GHL_API_TOKEN = process.env.GHL_API_TOKEN;
const GHL_API_URL = 'https://rest.gohighlevel.com/v1';

// Function to fetch leads from GHL pipeline
async function fetchLeadsFromPipeline(pipelineId) {
  const response = await axios.get(`${GHL_API_URL}/pipelines/${pipelineId}/opportunities`, {
    headers: {
      'Authorization': `Bearer ${GHL_API_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
  return response.data.data;
}

// Function to process leads for Cold Calling channel
async function processColdCallingLeads() {
  const pipelineId = 'o4kqU2y8DYjA73aKUxNu';
  const leads = await fetchLeadsFromPipeline(pipelineId);
  const totalDials = leads.length;
  const answeredLeads = leads.filter(lead => lead.status === 'answered');
  const answerRate = (answeredLeads.length / totalDials) * 100;
  const hotLeads = answeredLeads.filter(lead => lead.pipelineStageId === 'HOT');
  const warmLeads = answeredLeads.filter(lead => lead.pipelineStageId === 'WARM');
  const coldLeads = answeredLeads.filter(lead => lead.pipelineStageId === 'COLD');
  const costPerHotLead = (hotLeads.length * 0.50) + ((hotLeads.length * (30 / 60)) * 0.002); // Assuming 30 min per call

  return {
    totalDials,
    answerRate,
    hotLeads: hotLeads.length,
    warmLeads: warmLeads.length,
    coldLeads: coldLeads.length,
    costPerHotLead
  };
}

// Function to process leads for iSPEED TO LEAD channel
async function processISpeedToLeadLeads() {
  const pipelineId = 'VJwMSSMaP8KhiPiUfSG0';
  const leads = await fetchLeadsFromPipeline(pipelineId);
  let totalSpent = 0;
  let totalLeads = 0;
  let totalDeals = 0;
  const gradeConversionRates = { A: 0, B: 0, C: 0, D: 0 };
  const typeConversionRates = { exclusive: 0, non_exclusive: 0, coupon: 0, free: 0 };
  let totalRefundsRequested = 0;
  let totalRefundsApproved = 0;
  let totalRefundsDenied = 0;
  let totalRefundsPending = 0;
  let totalRefundMoneyRecovered = 0;

  leads.forEach(lead => {
    const notes = lead.notes.map(note => note.body).join(' ');
    const priceMatch = notes.match(/Price paid for lead: \$(\d+\.\d+)/);
    const gradeMatch = notes.match(/Predictor grade: ([A-D][+-])/);
    const typeMatch = notes.match(/Lead type: (exclusive|non-exclusive|coupon|free)/);
    const refundMatch = notes.match(/Refund deadline: (\d{2}\/\d{2}\/\d{4})/);

    if (priceMatch) {
      const price = parseFloat(priceMatch[1]);
      totalSpent += price;
      totalLeads++;
    }

    if (gradeMatch) {
      const grade = gradeMatch[1];
      gradeConversionRates[grade[0]]++;
    }

    if (typeMatch) {
      const type = typeMatch[1];
      typeConversionRates[type]++;
    }

    if (refundMatch) {
      const refundDeadline = new Date(refundMatch[1]);
      if (refundDeadline <= new Date()) {
        totalRefundsPending++;
      }
    }

    if (lead.pipelineStageId === 'DEAL') {
      totalDeals++;
    }
  });

  const averageCostPerLead = totalSpent / totalLeads;
  const conversionRateByGrade = { A: (gradeConversionRates['A'] / totalLeads) * 100, B: (gradeConversionRates['B'] / totalLeads) * 100, C: (gradeConversionRates['C'] / totalLeads) * 100, D: (gradeConversionRates['D'] / totalLeads) * 100 };
  const conversionRateByType = { exclusive: (typeConversionRates['exclusive'] / totalLeads) * 100, non_exclusive: (typeConversionRates['non_exclusive'] / totalLeads) * 100, coupon: (typeConversionRates['coupon'] / totalLeads) * 100, free: (typeConversionRates['free'] / totalLeads) * 100 };
  const costPerDeal = totalSpent / totalDeals;

  return {
    totalSpent,
    averageCostPerLead,
    conversionRateByGrade,
    conversionRateByType,
    costPerDeal,
    totalRefundsRequested,
    totalRefundsApproved,
    totalRefundsDenied,
    totalRefundsPending,
    totalRefundMoneyRecovered
  };
}

// Endpoint to get data for Marketing Intel page
export default async (req, res) => {
  try {
    const coldCallingData = await processColdCallingLeads();
    const iSpeedToLeadData = await processISpeedToLeadLeads();

    res.status(200).json({
      coldCallingData,
      iSpeedToLeadData
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
