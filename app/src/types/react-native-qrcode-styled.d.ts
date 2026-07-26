declare module "react-native-qrcode-styled" {
  import { Component } from "react";
  export interface QRCodeStyledProps {
    data: string;
    pieceSize?: number;
    color?: string;
    [key: string]: unknown;
  }
  export default class QRCodeStyled extends Component<QRCodeStyledProps> {}
}
