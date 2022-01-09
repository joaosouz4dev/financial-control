import logoImg from '../../assets/logo.svg'
import { Container, Content } from './styles'

interface HeaderProps {
  onOpenNewTransactionModal: () => void
  onOpenChartModal: () => void
}

export function Header({ onOpenNewTransactionModal, onOpenChartModal }: HeaderProps) {
  return (
    <Container>
      <Content>
        <img src={logoImg} alt="Logo dt money" />
        <button type="button" onClick={onOpenChartModal} style={{
          marginLeft: 'auto',
          marginRight: '10px'
        }}>
          Ver Gráfico
        </button>
        <button type="button" onClick={onOpenNewTransactionModal}>
          Nova transação
        </button>
      </Content>
    </Container>
  )
}
