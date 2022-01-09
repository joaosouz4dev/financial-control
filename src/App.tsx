import Modal from "react-modal";
import { useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";

import { Dashboard } from "./components/Dashboard";
import { Header } from "./components/Header";
import { GlobalStyle } from "./styles/global";
import { NewTransactionModal } from "./components/NewTransactionModal";
import { TransactionsProvider } from "./hooks/useTransactions";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

Modal.setAppElement("#root");
export const options = {
  responsive: true,
  plugins: {
    legend: {
      position: "top" as const,
    },
    title: {
      display: false,
    },
  },
};

export const data = {
  labels: [
    "Jan",
    "Fev",
    "Mar",
    "Abr",
    "Mai",
    "Jun",
    "Jul",
    "Ago",
    "Set",
    "Out",
    "Nov",
    "Dez",
  ],
  datasets: [
    {
      label: "Entradas",
      data: [
        3000, 3000, 3000, 3000, 3000, 3000, 3750, 3750, 3750, 3750, 6800, 6800,
      ],
      fill: true,
      backgroundColor: "#33cc9550",
      borderColor: "#33cc95",
    },
    {
      label: "Saidas",
      data: [
        3100, 3100, 3100, 3100, 3100, 3100, 3100, 3100, 3100, 3100, 6100, 6100,
      ],
      fill: false,
      backgroundColor: "#e52e4d50",
      borderColor: "#e52e4d",
    },
  ],
};

export function App() {
  const [isNewTransactionModalOpen, setIsNewTransactionModalOpen] =
    useState(false);

  const [openChart, setOpenChart] = useState(true);

  function handleOpenNewTransactionModal() {
    setIsNewTransactionModalOpen(true);
  }

  function handleCloseNewTransactionModal() {
    setIsNewTransactionModalOpen(false);
  }

  function handleOpenChartModal() {
    setOpenChart(!openChart);
  }

  return (
    <TransactionsProvider>
      <GlobalStyle />

      <Header
        onOpenNewTransactionModal={handleOpenNewTransactionModal}
        onOpenChartModal={handleOpenChartModal}
      />

      <NewTransactionModal
        isOpen={isNewTransactionModalOpen}
        onRequestClose={handleCloseNewTransactionModal}
      />

      <Dashboard />

      {openChart && (
        <div style={{
          maxWidth: "1120px",
          margin: "0 auto",
          marginBottom: "2rem",
        }}>
        <Line
          options={options}
          data={data}
          style={{
            backgroundColor: "#fff",
            width: "100%",
            margin: "0 1rem",
            padding: "40px",
            borderRadius: "0.3125rem",
          }}
        />
        </div>
      )}
    </TransactionsProvider>
  );
}
