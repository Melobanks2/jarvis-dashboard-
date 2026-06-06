import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar, Cell } from 'recharts';
import moment from 'moment';
import styles from '../styles/GlassCard.module.css';

const MarketingIntel = () => {
  const [data, setData] = useState({
    coldCallingData: {},
    iSpeedToLeadData: {}
  });

  useEffect(() => {
    const fetchData = async () => {
      const response = await fetch('/api/marketing-intel');
      const result = await response.json();
      setData(result);
    };

    fetchData();
    const interval = setInterval(fetchData, 30000); // Auto-refresh every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const {
    totalDials,
    answerRate,
    hotLeads,
    warmLeads,
    coldLeads,
    costPerHotLead,
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
  } = data.coldCallingData;

  const { iSpeedToLeadData } = data;

  const coldCallingChartData = [
    { name: 'Today', HOT: 5, WARM: 10, COLD: 15 },
    { name: 'Yesterday', HOT: 4, WARM: 11, COLD: 14 },
    { name: '2 days ago', HOT: 6, WARM: 9, COLD: 16 },
    { name: '3 days ago', HOT: 7, WARM: 8, COLD: 17 },
    { name: '4 days ago', HOT: 8, WARM: 7, COLD: 18 },
    { name: '5 days ago', HOT: 9, WARM: 6, COLD: 19 },
    { name: '6 days ago', HOT: 10, WARM: 5, COLD: 20 }
  ];

  const colorScheme = ['#8884d8', '#82ca9d', '#ffc658'];

  return (
    <div className={styles.container} style={{ background: '#121212', color: '#fff', padding: '20px' }}>
      <h1>Marketing Intel</h1>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ flex: 1, margin: '10px' }}>
          <h2>Cold Calling</h2>
          <p>Total Dials: {totalDials}</p>
          <p>Answer Rate: {answerRate.toFixed(2)}%</p>
          <p>HOT Leads: {hotLeads}</p>
          <p>WARM Leads: {warmLeads}</p>
          <p>COLD Leads: {coldLeads}</p>
          <p>Cost per HOT Lead: ${costPerHotLead.toFixed(2)}</p>

          <LineChart
            width={600}
            height={300}
            data={coldCallingChartData}
            margin={{
              top: 5,
              right: 30,
              left: 20,
              bottom: 5
            }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="HOT" stroke="#8884d8" activeDot={{ r: 8 }} />
            <Line type="monotone" dataKey="WARM" stroke="#82ca9d" />
            <Line type="monotone" dataKey="COLD" stroke="#ffc658" />
          </LineChart>

          <BarChart
            width={600}
            height={300}
            data={coldCallingChartData}
            margin={{
              top: 5,
              right: 30,
              left: 20,
              bottom: 5
            }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="HOT" stackId="a" fill="#8884d8" />
            <Bar dataKey="WARM" stackId="a" fill="#82ca9d" />
            <Bar dataKey="COLD" stackId="a" fill="#ffc658" />
          </BarChart>
        </div>

        <div style={{ flex: 1, margin: '10px' }}>
          <h2>iSPEED TO LEAD</h2>
          <p>Total Spent: ${totalSpent.toFixed(2)}</p>
          <p>Average Cost per Lead: ${averageCostPerLead.toFixed(2)}</p>
          <p>Conversion Rate by Grade: {JSON.stringify(conversionRateByGrade)}</p>
          <p>Conversion Rate by Type: {JSON.stringify(conversionRateByType)}</p>
          <p>Cost per Deal: ${costPerDeal.toFixed(2)}</p>
          <p>Refunds: Requested: {totalRefundsRequested}, Approved: {totalRefundsApproved}, Denied: {totalRefundsDenied}, Pending: {totalRefundsPending}</p>
          <p>Refund Money Recovered: ${totalRefundMoneyRecovered.toFixed(2)}</p>

          <input type="number" placeholder="Marketing Budget" />
          <input type="number" placeholder="Investment" />
          <button>Calculate ROI</button>
        </div>

        <div style={{ flex: 1, margin: '10px' }}>
          <h2>PROPERTY LEADS PPC</h2>
          <input type="text" placeholder="Input Field 1" />
          <input type="text" placeholder="Input Field 2" />
          <input type="text" placeholder="Input Field 3" />
          <button>Submit</button>
        </div>
      </div>

      <div style={{ marginTop: '20px' }}>
        <h2>MASTER ROI SECTION</h2>
        <p>Total Spend All Channels: ${totalSpent.toFixed(2)}</p>
        <p>Total Revenue from Closed Deals: $0.00</p>
        <p>Overall ROI Multiplier: 0.00x</p>
        <p>Revenue Gauge: 0%</p>

        <BarChart
          width={800}
          height={300}
          data={[
            { name: 'Cold Calling', ROI: 1.2 },
            { name: 'iSPEED TO LEAD', ROI: 0.9 },
            { name: 'PROPERTY LEADS PPC', ROI: 0.8 }
          ]}
          margin={{
            top: 5,
            right: 30,
            left: 20,
            bottom: 5
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey="ROI" fill="#8884d8" />
        </BarChart>
      </div>

      <div style={{ marginTop: '20px' }}>
        <h2>PREDICTOR GRADE INTELLIGENCE</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>Grade</th>
              <th>Conversion Rate</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(conversionRateByGrade).map(([grade, rate]) => (
              <tr key={grade}>
                <td>{grade}</td>
                <td>{rate.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MarketingIntel;
